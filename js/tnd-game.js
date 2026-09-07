// TnD 결합 데모 — 순수 게임 로직 (DOM 의존 없음). 기획안 결합 v2.2.
import { OPPOSITE, FACE_COUNT, condAllows } from './config.js';
import { mulberry32, faceState, layerMatches } from './game.js';
import {
  TND, MONSTERS, WAVES, CORRUPT_TYPES, leakLabel, ENGRAVINGS_BY_ID, MOVE_MODE_LABEL,
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
    case 'homeNear': return Math.min(ctx.playerPos, N - ctx.playerPos) <= TND.HOME_RANGE ? add(skill.v) : null;
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
  const lines = []; const growthEvents = []; const fired = []; // fired: { die, face(-1=각인), op, n, note }
  let S = ctx.accBonus || 0;
  dice.forEach((d, i) => {
    const e = engrOf(d);
    const noActiveSkill = !d.faces[d.upIndex].skill;
    if (e?.id === 'heonsin' && noActiveSkill) { S += activePips[i] * 3; lines.push({ text: `[${'①②③'[i]}] 헌신 · 눈 ${activePips[i]} ×3`, type: 'calc' }); fired.push({ die: i, face: -1, name: '헌신', op: 'add', n: activePips[i] * 2, note: '' }); }
    else S += activePips[i];
  });
  lines.unshift({ text: `기본 눈합  ${S}`, type: 'calc' });
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
      fired.push({ die: di, face: f, name: skill.name, op: eff.op, n: eff.n, note });
      if (skill.kind === 'growCount') growthEvents.push({ uid: inst.uid, field: 'count', delta: 1 });
      if (skill.kind === 'growAdd' || skill.kind === 'growMult') growthEvents.push({ uid: inst.uid, field: 'growth', delta: skill.step });
    }
    if (e?.id === 'jjakheart' && upPip % 2 === 0) { S = ceil(S * 1.2); lines.push({ text: `[${'①②③'[di]}] 짝의 심장  ×1.2  →  ${S}`, type: 'mul' }); fired.push({ die: di, face: -1, name: '짝의 심장', op: 'mul', n: 1.2, note: '' }); }
  });
  return { total: S, lines, growthEvents, fired };
}
function fmtN(n) { return Number.isInteger(n) ? String(n) : (Math.round(n * 1000) / 1000).toString(); }

export function convert(points, gauge) {
  let faith = 0, combo = 0, fills = 0, guard = 0;
  while (points > 0 && guard++ < 10000) {
    const need = TND.GAUGE - gauge;
    if (points >= need) { points -= need; faith += 1; fills += 1; if (fills >= 2) combo = Math.min(TND.COMBO_MAX, combo + 1); gauge = combo; }
    else { gauge += points; points = 0; }
  }
  return { faith, gauge, fills, combo };
}

// ── 이동 해석 (순수 함수): 방식에 따른 경유(밟음)/도착(멈춤) 집합. 플레이어 프리뷰·실제 이동·몬스터 한 바퀴 해석이 공유.
// 반환 { path:[{cell, pass, stop}], to, crossings }  (dir = +1 정방향 / −1 역방향)
export function resolveMove(board, from, n, mode, opts = {}) {
  const dir = opts.dir || 1; const path = [];
  for (let k = 1; k <= n; k++) {
    const cell = wrap(from + dir * k); const last = k === n;
    let pass = false, stop = false;
    if (mode === 'basic') { pass = true; stop = last; }
    else if (mode === 'teleport') { pass = last; stop = last; }
    else if (mode === 'jump') { pass = k % 2 === 0 || last; stop = last; }
    else if (mode === 'slow') { pass = true; stop = true; }
    path.push({ cell, pass, stop });
  }
  return { path, to: wrap(from + dir * n), crossings: dir > 0 ? Math.floor((from + n) / N) : 0 };
}

// ── 보드 순수 헬퍼 (엔진과 resolveLap이 공유)
export const emptyCell = id => ({ id, piece: null, corrupt: null });
export const cloneBoard = board => board.map(c => ({ id: c.id, piece: c.piece ? { ...c.piece } : null, corrupt: c.corrupt ? { ...c.corrupt } : null }));
const cellAt = (board, id) => board[wrap(id)];
const mine = (board, cell, defId) => cell.piece?.owner === 'P' && !cell.corrupt && (!defId || cell.piece.defId === defId);
// 대성당 오라: 좌우 2칸 기물의 모든 효과 ×2
export function auraMult(board, cell) {
  for (let d = -2; d <= 2; d++) { if (d === 0) continue; if (mine(board, cellAt(board, cell.id + d), 'cathedral')) return 2; }
  return 1;
}
// 타락 만료 (유형별). 보드만 바꾸고 사건을 돌려준다.
export function expireCorrupt(cell) {
  const type = cell.corrupt?.type || 'erode'; const T = CORRUPT_TYPES[type] || CORRUPT_TYPES.erode;
  cell.corrupt = null; const events = [];
  const gain = type === 'nest' ? 2 : 1; let destroyed = false;
  if (cell.piece?.owner === 'P') { events.push({ text: `파괴됨  칸 ${cell.id} ${PIECES_BY_ID[cell.piece.defId].name} G${cell.piece.grade} (${T.name} 만료)`, type: 'event' }); cell.piece = null; destroyed = true; }
  if (type === 'corrode' && destroyed) return events; // 부식: 내 기물만 파괴, 사악한 기물은 생기지 않음
  if (cell.piece?.owner === 'E') { const b = cell.piece.grade; cell.piece.grade = Math.min(TND.MAX_GRADE, b + gain); events.push({ text: `${T.name} 만료  칸 ${cell.id} · 사악한 기물 G${b} → G${cell.piece.grade}`, type: 'event' }); }
  else { cell.piece = { owner: 'E', grade: gain }; events.push({ text: `${T.name} 만료  칸 ${cell.id} · 사악한 기물 G${gain} 건설`, type: 'event' }); }
  return events;
}

// ── 몬스터 한 바퀴 해석 (순수 함수, §13.2). 웨이브 프리뷰와 실제 웨이브가 같은 함수를 쓴다.
// board와 m은 이 함수 안에서 바뀐다 (프리뷰는 복제본을 넘긴다). m: { name, mark, hp, pos, step, dir, nextMod, passageUsed, def }
// 반환 { path:[{cell, pass, stop, cause}], stops:[cell], damage, killedAt, escaped, events:[{text,type}], moves }
export function resolveLap(board, m) {
  const def = m.def; const P = def.pattern; const events = []; const path = []; const stops = [];
  const name = m.label || m.name; // 여러 마리 웨이브면 '약탈자 ①'처럼 순번이 붙는다
  const ev = (text, type = 'calc') => events.push({ text, type });
  let damage = 0, killedAt = null, escaped = false, moves = 0;
  const hit = (x, prefix) => { if (x <= 0) return true; m.hp -= x; damage += x; ev(`${prefix} · −${x} (잔량 ${Math.max(0, m.hp)})`); if (m.hp <= 0) { killedAt = m.pos; ev(`★ ${name} 처치 · 칸 ${m.pos}`, 'event'); return false; } return true; };
  const passageOf = cell => { if (!mine(board, cell, 'passage')) return null; const other = board.find(c => c.id !== cell.id && mine(board, c, 'passage')); return other || null; };
  // 밟음 (foePass): 피해 · 늪
  const foePass = cell => {
    if (!mine(board, cell)) return true;
    const pd = PIECES_BY_ID[cell.piece.defId]; const g = cell.piece.grade; const mult = auraMult(board, cell); const au = mult > 1 ? ' (대성당 ×2)' : '';
    const pre = `${name} 밟음  칸 ${cell.id} ${pd.name} G${g}${au}`;
    switch (pd.id) {
      case 'altar': return hit(g * mult, pre);
      case 'sanctum': return hit(2 * g * mult, pre);
      case 'spire': return hit(g * g * mult, pre);
      case 'swamp': { m.nextMod += g * mult; ev(`늪 · ${name} 다음 이동 −${g * mult} (누적 −${m.nextMod})`, 'event'); return true; }
      default: return true;
    }
  };
  // 멈춤 (foeStop): 피해 · 종탑 · 거울 · 통로. 반환 { alive, retreated }
  const foeStop = (cell, dirUsed) => {
    if (cell.corrupt) { cell.corrupt.counter -= 1; ev(`${name} 멈춤  칸 ${cell.id} 타락 · 카운터 −1 → ${cell.corrupt.counter}`, 'action'); if (cell.corrupt.counter <= 0) events.push(...expireCorrupt(cell)); return { alive: true }; }
    if (!mine(board, cell)) return { alive: true };
    const pd = PIECES_BY_ID[cell.piece.defId]; const g = cell.piece.grade; const mult = auraMult(board, cell); const au = mult > 1 ? ' (대성당 ×2)' : '';
    const pre = `${name} 멈춤  칸 ${cell.id} ${pd.name} G${g}${au}`;
    switch (pd.id) {
      case 'altar': return { alive: hit(3 * g * mult, pre) };
      case 'sanctum': return { alive: hit(6 * g * mult, pre) };
      case 'spire': return { alive: hit(3 * g * g * mult, pre) };
      case 'cathedral': return { alive: hit(10 * g * mult, pre) };
      case 'bell': { const back = 2 * g * mult; m.pos = wrap(m.pos - dirUsed * back); ev(`종탑 · ${name} ${back}칸 후퇴 → 칸 ${m.pos}`, 'event'); return { alive: true, retreated: true }; }
      case 'mirror': { m.dir = -1; ev(`거울 · ${name} 다음 이동 역방향`, 'event'); return { alive: true }; }
      case 'passage': {
        const other = passageOf(cell); if (!other || m.passageUsed) return { alive: true };
        m.passageUsed = true; m.pos = other.id; ev(`통로 · ${name} 칸 ${cell.id}→${other.id}`, 'event');
        path.push({ cell: other.id, pass: false, stop: true, cause: 'passage' }); stops.push(other.id);
        return { alive: true }; // 도착한 통로에서 멈춤 판정: 통로 자체는 추가 효과 없음 (바퀴당 1회)
      }
      default: return { alive: true };
    }
  };
  while (killedAt === null && !escaped && moves < TND.LAP_MOVE_CAP) {
    moves++;
    let n = P[m.step % P.length]; const mark = '①②③④⑤⑥'[m.step % P.length] || `${m.step % P.length + 1}`; m.step += 1;
    if (m.nextMod > 0) { const n0 = n; n = Math.max(1, n - m.nextMod); ev(`늪 · ${name} 이동 ${n0} → ${n}`, 'event'); m.nextMod = 0; }
    const dir = m.dir; if (dir < 0) ev(`거울 · ${name} 역방향 이동`, 'event'); m.dir = 1;
    const r = resolveMove(board, m.pos, n, def.moveMode, { dir });
    ev(`${name} ${mark} 이동 ${n}(${MOVE_MODE_LABEL[def.moveMode]}${dir < 0 ? '·역' : ''}) → 칸 ${r.to}`, 'action');
    let stopped = false;
    for (const step of r.path) {
      if (dir > 0 && step.cell === TND.START_CELL) { escaped = true; m.pos = TND.START_CELL; break; } // 정방향 시작칸 통과 = 탈출
      m.pos = step.cell; const cell = board[step.cell];
      let forced = null;
      if (step.pass && mine(board, cell, 'gate') && (cell.piece.charges || 0) > 0) { cell.piece.charges -= 1; forced = 'gate'; ev(`성문 닫힘 · ${name} 칸 ${cell.id} 정지 (남은 ${cell.piece.charges})`, 'event'); }
      else if (step.pass && mine(board, cell, 'decoy') && step.cell !== r.to) {
        const range = cell.piece.grade * auraMult(board, cell); const ahead = wrap(dir * (r.to - cell.id));
        if (ahead <= range) { forced = 'decoy'; ev(`미끼 · ${name} 도착 ${r.to}→${cell.id}`, 'event'); }
      }
      const isStop = step.stop || !!forced;
      path.push({ cell: step.cell, pass: step.pass, stop: isStop, cause: forced });
      if (step.pass && !foePass(cell)) break;
      if (isStop) {
        stops.push(step.cell);
        const s = foeStop(cell, dir); if (!s.alive) break;
        if (s.retreated) { stopped = true; break; } // 후퇴 후 멈춤 처리 없음, 남은 이동은 없다 (도착 칸에서 멈춘 것)
      }
      if (forced) { stopped = true; break; } // 남은 이동 소멸
    }
    void stopped;
  }
  if (killedAt === null && !escaped) { escaped = true; ev(`${name} 이동 한도(${TND.LAP_MOVE_CAP}) 초과 · 탈출 처리`, 'event'); }
  return { path, stops, damage, killedAt, escaped, events, moves, hp: m.hp };
}

export class TndGame {
  constructor({ rng, monsters, waves } = {}) {
    this.rng = rng || Math.random;
    // 몬스터·웨이브는 데이터: 정의 사전과 웨이브 배열을 통째로 교체할 수 있다 (코드 수정 없이 동작)
    this.monsterDefs = monsters || MONSTERS; this.waves = waves || WAVES;
    this.onChange = null; this.log = [];
    this.dice = Array.from({ length: TND.DICE }, () => ({
      faces: Array.from({ length: FACE_COUNT }, (_, f) => ({ pip: f + 1, skill: null })),
      engraving: null, upIndex: 0, locked: false, pipBonus: 0, lastUp: null,
    }));
    for (const [d, faces] of Object.entries(STARTER_BUILD)) for (const [f, id] of Object.entries(faces)) this.dice[d].faces[f].skill = makeInst(id);
    this.deck = [...STARTER_DECK];
    this.phase = 'prep'; this.sub = null; this.pending = null; this.result = null; this.queue = [];
    this.selectedDie = null; this.selectedFace = null; this.selectedSkill = null; this.selectedEngraving = null;
    this.board = []; this.player = null; this.monsters = []; this.turn = 0; this.escapes = 0; this.kills = 0;
  }
  _emit() { if (this.onChange) this.onChange(); }
  addLog(text, type = 'action') { this.log.push({ text, type }); if (this.log.length > 3000) this.log.splice(0, this.log.length - 3000); }

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
  auraMult(cell) { return auraMult(this.board, cell); }
  effGrade(cell, chukbok = false) { return Math.min(TND.MAX_GRADE, cell.piece.grade + (chukbok ? 1 : 0)); }
  waveCount() { return this.waves.length; }
  currentWave() { return this.waves[this.turn - 1] || null; }
  isBossWave() { return this.turn === this.waves.length; }
  // 웨이브 프리뷰 (§8.4): 현재 보드 복제본으로 이번 웨이브를 끝까지 해석. 기물을 짓거나 올릴 때마다 갱신된다.
  wavePreview() {
    if (this.phase !== 'trial' || this.sub === 'wave') return null;
    const board = cloneBoard(this.board);
    for (const c of board) if (c.corrupt && --c.corrupt.counter <= 0) expireCorrupt(c); // 방출 직전의 타락 카운터 −1(만료 포함)까지 반영해야 실제와 정확히 일치
    const rows = this.monsters.map(src => {
      const m = { ...src, def: src.def };
      const r = resolveLap(board, m);
      const changed = r.path.filter(p => p.cause).map(p => ({ cell: p.cell, cause: p.cause }));
      return { uid: src.uid, name: src.name, icon: src.def.icon, mark: src.mark, hp: src.hp, maxHp: src.maxHp, boss: !!src.boss, moveMode: src.def.moveMode, pattern: src.def.pattern,
        leakText: src.boss ? '탈출 = 패배' : leakLabel(src.def.leak), damage: r.damage, killedAt: r.killedAt, escaped: r.escaped, remaining: Math.max(0, src.hp - r.damage), path: r.path, stops: r.stops, changed, moves: r.moves };
    });
    return { rows, anyEscape: rows.some(r => r.escaped), bossEscape: rows.some(r => r.escaped && r.boss) };
  }
  // 이번 턴 업그레이드 가능 여부: 밟은 칸(정가 = 비용÷2) / 멈춘 칸(반값 = 비용÷4). 지나가지 않은 기물은 불가
  upgradeInfo(pos) {
    const cell = this.board[pos]; if (!this.player || cell?.piece?.owner !== 'P') return null;
    const def = PIECES_BY_ID[cell.piece.defId]; const stopped = this.player.stoppedAt.includes(pos); const passed = stopped || this.player.passedAt.includes(pos);
    if (!passed) return null;
    return { pos, name: def.name, grade: cell.piece.grade, perLevel: upgradeCost(def, stopped), stopped, reload: def.id === 'gate' };
  }
  passedPieces() { return this.myPieces().filter(c => this.upgradeInfo(c.id)); }

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
    this.player = { pos: 0, faith: TND.PLAYER_START_FAITH, gauge: 0, purifyCost: TND.PURIFY_START, laps: 0, stoppedAt: [], passedAt: [] };
    this.monsters = []; this.monsterUid = 1; this.kills = 0; this.escapes = 0;
    for (const inst of this.allInstances()) { inst.growth = 0; inst.count = 0; }
    for (const d of this.dice) { d.locked = false; d.pipBonus = 0; d.lastUp = null; }
    this.turn = 0; this.result = null; this.pending = null; this.queue = []; this.log = [];
    this.usedDice = []; this.segment = null;
    this.phase = 'trial';
    this.addLog(`━━ 고행 시작 — 웨이브 ${this.waves.length}개 · 마지막은 보스 ━━`, 'event');
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
  _spawnWave() { // 이번 턴의 웨이브 몬스터를 대기열에 (시작칸). 해석 순서 = 표 순서
    const w = this.currentWave(); this.monsters = [];
    w.monsters.forEach((e, k) => { const def = this.monsterDefs[e.defId]; const name = e.name || def.name; const mark = '①②③④⑤⑥'[k] || `${k + 1}`;
      this.monsters.push({ uid: this.monsterUid++, def, name, mark, label: w.monsters.length > 1 ? `${name} ${mark}` : name, hp: e.hp, maxHp: e.hp, boss: !!e.boss, pos: TND.START_CELL, step: 0, dir: 1, nextMod: 0, passageUsed: false }); });
  }
  waveSummary(w = this.currentWave()) {
    const cnt = {}; for (const e of w.monsters) { const n = e.name || this.monsterDefs[e.defId].name; cnt[n] = (cnt[n] || 0) + 1; }
    const hps = [...new Set(w.monsters.map(e => e.hp))];
    return `${Object.entries(cnt).map(([n, k]) => k > 1 ? `${n} ×${k}` : n).join(' + ')} (HP ${hps.join('/')})`;
  }
  _startPlayerTurn() {
    this.turn += 1; this.sub = 'roll'; this.usedDice = []; this.segment = null; this.player.stoppedAt = []; this.player.passedAt = [];
    this.rollsLeft = TND.ROLLS_PER_TURN; this.rollNo = 1;
    this._spawnWave();
    this.addLog(`── 턴 ${this.turn} · 내 턴 — 웨이브 ${this.turn}/${this.waves.length}${this.isBossWave() ? ' (보스)' : ''}: ${this.waveSummary()} ──`, 'action');
    // 인내: 잠긴 채 넘어온 주사위는 굴리지 않고 눈 +1
    this.dice.forEach((d, i) => {
      if (d.locked && engrOf(d)?.id === 'innae') { d.pipBonus = Math.min(6 - d.faces[d.upIndex].pip, d.pipBonus + 1); this.addLog(`[${'①②③'[i]}] 인내 · 잠긴 채 유지, 눈 +${d.pipBonus} → ${effPip(d)}`, 'calc'); }
      else d.locked = false;
    });
    this._rollUnlocked(false);
    this.rollsLeft -= 1;
    const pv = this.wavePreview();
    for (const r of pv.rows) this.addLog(`▶ ${r.name} ${pv.rows.length > 1 ? r.mark + ' ' : ''}프리뷰: 멈춤 ${r.stops.join('·') || '없음'} · ${r.killedAt !== null ? `처치 예상 (칸 ${r.killedAt})` : `탈출 예상 · 부족 ${r.remaining}`}`, 'event');
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
  _calcCtx() { return { rerollsLeft: this.rollsLeft, pieces: this.myPieceCount(), corrupts: this.corruptCount(), enemyPieces: this.enemyPieceCount(), playerPos: this.player.pos }; }
  preview() {
    if (this.phase !== 'trial' || this.sub !== 'roll') return null;
    const r = calcFaithPoints(this.dice, this._calcCtx());
    const c = convert(r.total, this.player.gauge);
    return { points: r.total, faith: c.faith, gauge: c.gauge, fired: r.fired };
  }
  // 주사위 판 면 상태: 스킬이 있는 면마다 상태(활성/맞은편/측면)·발동 여부·효과. 정산 프리뷰(calcFaithPoints)와 같은 계산.
  faceStatus() {
    if (!this.player) return null;
    const fired = calcFaithPoints(this.dice, this._calcCtx()).fired;
    return this.dice.map((d, di) => {
      const e = engrOf(d);
      const order = [d.upIndex, OPPOSITE[d.upIndex], ...d.faces.map((_, f) => f).filter(f => f !== d.upIndex && f !== OPPOSITE[d.upIndex])];
      const faces = order.filter(f => d.faces[f].skill).map(f => {
        const skill = TND_SKILLS_BY_ID[d.faces[f].skill.id]; const state = faceState(f, d.upIndex);
        const hit = fired.find(x => x.die === di && x.face === f) || null;
        return { face: f, pip: d.faces[f].pip, skill, state, layerOk: layerMatches(skill.layer, state), fired: !!hit, op: hit?.op, n: hit?.n, note: hit?.note || '', gongheo: e?.id === 'gongheo' && state !== 'active' };
      });
      const engr = fired.filter(x => x.die === di && x.face === -1);
      return { die: di, faces, engr, firedCount: faces.filter(x => x.fired).length + engr.length };
    });
  }
  confirm() {
    if (this.phase !== 'trial' || this.sub !== 'roll') return false;
    const r = calcFaithPoints(this.dice, this._calcCtx());
    const byUid = new Map(this.allInstances().map(i => [i.uid, i]));
    for (const ev of r.growthEvents) { const inst = byUid.get(ev.uid); if (inst) inst[ev.field] = Math.round((inst[ev.field] + ev.delta) * 10) / 10; }
    this.addLog('── 정산 ──', 'action');
    for (const l of r.lines) this.addLog(l.text, l.type);
    this.addLog(`신앙치 ${r.total}`, 'calc');
    const c = convert(r.total, this.player.gauge);
    this.player.gauge = c.gauge;
    this.player.faith += c.faith;
    this.addLog(`게이지 충전 ×${c.fills} · 콤보 ${c.combo} · 신앙 +${c.faith}`, 'calc');
    this.addLog(`신앙 ${this.player.faith} (+${c.faith}) · 게이지 잔량 ${this.player.gauge}`, 'calc');
    this.sub = 'act'; this._emit(); return true;
  }

  // ───────── 행동 단계: 구간 이동 ─────────
  moveModeOf(die) { const e = engrOf(die); return { mode: e?.moveMode || 'basic', extra: e?.extra || 0 }; }
  // 프리뷰: 현재 위치 기준 이 주사위 구간의 경유/도착 (실제 이동과 같은 함수)
  previewSegment(i) {
    if (this.phase !== 'trial' || this.sub !== 'act' || this.usedDice.includes(i)) return null;
    const die = this.dice[i]; const { mode, extra } = this.moveModeOf(die);
    return { die: i, mode, ...resolveMove(this.board, this.player.pos, effPip(die) + extra, mode) };
  }
  // 경로 계획: 남은 주사위의 모든 순열로 도달 가능한 멈춤 칸
  routePlan() {
    if (this.phase !== 'trial' || this.sub !== 'act') return [];
    const rest = this.dice.map((_, i) => i).filter(i => !this.usedDice.includes(i));
    const stops = new Set();
    const rec = (pos, remaining) => {
      for (const i of remaining) {
        const { mode, extra } = this.moveModeOf(this.dice[i]);
        const r = resolveMove(this.board, pos, effPip(this.dice[i]) + extra, mode);
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
    const r = resolveMove(this.board, this.player.pos, effPip(die) + extra, mode);
    this.usedDice.push(i);
    const segNo = this.usedDice.length;
    this.segment = { die: i, mode, chukbok: e?.id === 'chukbok', holy: e?.id === 'jeonghwabal', gaecheok: e?.id === 'gaecheok', jingsu: e?.id === 'jingsu', fold: [], no: segNo };
    this.addLog(`이동 ${segNo}/3  ${'①②③'[i]}${e ? e.name : ''}(${MOVE_MODE_LABEL[mode]}) [${effPip(die)}${extra ? `+${extra}` : ''}] → 칸 ${r.to}`, 'action');
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
            if (!this.player.passedAt.includes(step.cell)) this.player.passedAt.push(step.cell);
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
          if (this.player.faith + this.totalSellable() < cost) this.addLog(`✕ 강제지불 ${cost} · 지불 불가. 게임 포기 가능.`, 'decision');
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
          this.addLog(`멈춤 ${this.segment.no}/3  칸 ${cell.id} · 내 기물 ${def.name} G${cell.piece.grade} (반값 업그레이드 가능)`, 'action');
          if (cell.corrupt) { this.addLog(`${def.name} 효과 무효 (타락 칸)`, 'calc'); break; }
          if (this._myStop(cell)) return; // 통로 선택 창
          break;
        }
        case 'destroy': {
          if (cell.piece?.owner !== 'E') break;
          this.pending = { type: 'destroy', pos: cell.id, cost: ceil(this.finalEnemyCost(cell) * TND.DESTROY_MULT), grade: cell.piece.grade }; this.sub = 'dialog'; return;
        }
        case 'build': {
          if (cell.piece || cell.corrupt || cell.id === TND.START_CELL) break;
          this.pending = { type: 'build', pos: cell.id, discount: this.segment?.gaecheok ? 0.3 : 0 }; this.sub = 'dialog'; return;
        }
        case 'segEnd': {
          this._flushFold();
          if (this.usedDice.length >= this.dice.length) {
            const total = this.dice.reduce((s, d) => s + effPip(d) + (this.moveModeOf(d).extra || 0), 0);
            this.addLog(`이동 완료 · 턴 이동 합 ${total} · 현재 칸 ${this.player.pos}`, 'action');
            this.sub = 'build'; this.segment = null;
          } else { this.sub = 'act'; this.segment = null; }
          return;
        }
      }
    }
  }

  // ───────── 대화창 응답 ─────────
  _resume() { if (this.pending) return; this.sub = 'act'; this._next(); }
  canPay() { return !!this.pending && this.pending.type === 'pay' && this.player.faith >= this.pending.cost; }
  mustGiveUp() { return !!this.pending && this.pending.type === 'pay' && this.player.faith + this.totalSellable() < this.pending.cost; }
  payConfirm() {
    const p = this.pending; if (!p || p.type !== 'pay' || this.player.faith < p.cost) return false;
    this.player.faith -= p.cost;
    this.addLog(`강제지불  사악한 기물 G${this.board[p.pos].piece.grade} · ${p.cost} 신앙 (잔여 ${this.player.faith})`, 'event'); this.pending = null; this._resume();
    this._emit(); return true;
  }
  sellPiece(pos) {
    const cell = this.board[pos];
    if (!this.pending || this.pending.type !== 'pay' || cell.piece?.owner !== 'P') return false;
    const def = PIECES_BY_ID[cell.piece.defId]; const grade = cell.piece.grade; const price = sellPrice(def, grade);
    this.player.faith += price; cell.piece = null;
    this.addLog(`판매  칸 ${pos} ${def.name} G${grade} · +${price} 신앙`, 'action');
    this._emit(); return true;
  }
  giveUp() {
    const p = this.pending; if (!p || p.type !== 'pay') return false;
    this._finish('defeat', `✕ 강제지불 ${p.cost} · 지불 불가. 패배.`);
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
    if (pieceId === 'gate') this.board[p.pos].piece.charges = 1;
    this.addLog(`건설  칸 ${p.pos} ${PIECES_BY_ID[pieceId].name} G1 · ${cost} 신앙${p.discount ? ' (개척 −30%)' : ''}`, 'action');
    this.pending = null; this._resume(); this._emit(); return true;
  }
  skipBuild() { if (!this.pending || this.pending.type !== 'build') return false; this.pending = null; this._resume(); this._emit(); return true; }
  // 통로: 다른 통로로 순간이동을 선택
  passageGo() {
    const p = this.pending; if (!p || p.type !== 'passage') return false;
    this.player.pos = p.to; if (!this.player.stoppedAt.includes(p.to)) this.player.stoppedAt.push(p.to); if (!this.player.passedAt.includes(p.to)) this.player.passedAt.push(p.to);
    this.addLog(`통로 · 내 말 칸 ${p.pos}→${p.to}`, 'event');
    this.pending = null; this._resume(); this._emit(); return true;
  }
  passageStay() { if (!this.pending || this.pending.type !== 'passage') return false; this.addLog('통로 · 이동하지 않음', 'calc'); this.pending = null; this._resume(); this._emit(); return true; }

  // ───────── 업그레이드 (밟음 한정, 행동·건설 단계 중 언제든) · 턴 종료 = 웨이브 방출 ─────────
  upgradePiece(pos, target) {
    if (this.phase !== 'trial' || (this.sub !== 'build' && this.sub !== 'act')) return false;
    const info = this.upgradeInfo(pos); if (!info) return false;
    const levels = target - info.grade; if (levels < 1 || target > TND.MAX_GRADE) return false;
    const total = levels * info.perLevel; if (this.player.faith < total) return false;
    this.player.faith -= total; this.board[pos].piece.grade = target;
    let note = info.stopped ? ' (멈춤·반값)' : ' (밟음)';
    if (info.reload) { this.board[pos].piece.charges = target; note += ` · 닫힘 ${target}으로 재장전`; }
    this.addLog(`업그레이드  칸 ${pos} ${info.name} G${info.grade} → G${target} · ${total} 신앙${note}`, 'action');
    this._emit(); return true;
  }
  endTurn({ force = false } = {}) {
    if (this.phase !== 'trial' || this.sub !== 'build') return false;
    const pv = this.wavePreview();
    if (pv.anyEscape && !force) { this.pending = { type: 'release', names: pv.rows.filter(r => r.escaped).map(r => `${r.name} ${r.mark}`), boss: pv.bossEscape }; this.sub = 'dialog'; this._emit(); return true; }
    this._endPlayerTurn(); this._emit(); return true;
  }
  releaseConfirm() { if (!this.pending || this.pending.type !== 'release') return false; this.pending = null; this.sub = 'build'; this._endPlayerTurn(); this._emit(); return true; }
  releaseCancel() { if (!this.pending || this.pending.type !== 'release') return false; this.pending = null; this.sub = 'build'; this._emit(); return true; }
  _endPlayerTurn() {
    for (const cell of this.board) {
      if (!cell.corrupt) continue;
      cell.corrupt.counter -= 1;
      this.addLog(`타락  칸 ${cell.id} 카운터 ${cell.corrupt.counter + 1} → ${cell.corrupt.counter}`, 'action');
      if (cell.corrupt.counter <= 0) for (const e of expireCorrupt(cell)) this.addLog(e.text, e.type);
    }
    for (const d of this.dice) if (!(d.locked && engrOf(d)?.id === 'innae')) d.locked = false; // 인내: 잠금 유지
    this._resolveWave();
  }

  // ───────── 기물 효과 (플레이어) ─────────
  _myPass(cell) { // 반환: 효과가 있었는가
    if (cell.piece?.owner !== 'P' || cell.corrupt) return false;
    const def = PIECES_BY_ID[cell.piece.defId]; const g = this.effGrade(cell, this.segment?.chukbok); const m = this.auraMult(cell);
    switch (def.id) {
      case 'well': { const n = g * m; this.player.gauge = Math.min(TND.GAUGE, this.player.gauge + n); this.addLog(`밟음  칸 ${cell.id} ${def.name} G${g} · 게이지 +${n} → ${this.player.gauge}`, 'calc'); return true; }
      default: return false;
    }
  }
  _myStop(cell) { // 반환: 대화창을 세웠는가
    const def = PIECES_BY_ID[cell.piece.defId]; const g = this.effGrade(cell, this.segment?.chukbok); const m = this.auraMult(cell);
    switch (def.id) {
      case 'altar': { this.player.faith += m; this.addLog(`${def.name} G${g} · 신앙 +${m}`, 'calc'); return false; }
      case 'well': { const n = 3 * g * m; this.player.gauge = Math.min(TND.GAUGE, this.player.gauge + n); this.addLog(`${def.name} G${g} · 게이지 +${n} → ${this.player.gauge}`, 'calc'); return false; }
      case 'passage': {
        const other = this.board.find(c => c.id !== cell.id && mine(this.board, c, 'passage'));
        if (!other) { this.addLog(`${def.name} · 짝이 없어 작동하지 않음`, 'calc'); return false; }
        this.pending = { type: 'passage', pos: cell.id, to: other.id }; this.sub = 'dialog'; return true;
      }
      default: return false;
    }
  }

  // ───────── 타락 배치 (탈출 결과) ─────────
  _cells(pred) { return this.board.filter(c => c.id !== TND.START_CELL && pred(c)); }
  _pick(arr) { return arr.splice(Math.floor(this.rng() * arr.length), 1)[0]; }
  _leakTargets(leak) {
    const free = c => !c.corrupt; const out = [];
    const take = (cands, k) => { while (out.length < k && cands.length) out.push(this._pick(cands)); };
    const emptyRandom = () => { take(this._cells(c => free(c) && !c.piece && !out.includes(c)), leak.count); take(this._cells(c => free(c) && !out.includes(c)), leak.count); };
    switch (leak.placement) {
      case 'pieceFirst': take(this._cells(c => free(c) && c.piece?.owner === 'P'), leak.count); emptyRandom(); break;
      case 'highestPiece': {
        const mine_ = this._cells(c => free(c) && c.piece?.owner === 'P').sort((a, b) => b.piece.grade - a.piece.grade);
        while (out.length < leak.count && mine_.length) { const top = mine_.filter(c => c.piece.grade === mine_[0].piece.grade); const c = this._pick(top); mine_.splice(mine_.indexOf(c), 1); out.push(c); }
        emptyRandom(); break;
      }
      case 'nearStart': take(this._cells(c => free(c) && c.id >= 1 && c.id <= TND.HOME_RANGE), leak.count); emptyRandom(); break;
      case 'consecutive': {
        const run = s0 => Array.from({ length: leak.count }, (_, k) => this.cellAt(s0 + k));
        const starts = this._cells(free).filter(c => run(c.id).every(x => x.id !== TND.START_CELL && free(x)));
        if (starts.length) out.push(...run(this._pick(starts).id));
        emptyRandom(); break;
      }
      default: emptyRandom();
    }
    return out.slice(0, leak.count);
  }
  _leak(m) {
    const leak = m.def.leak; const T = CORRUPT_TYPES[leak.type];
    const targets = this._leakTargets(leak);
    for (const c of targets) c.corrupt = { counter: T.counter, type: leak.type };
    const where = targets.map(c => `칸 ${c.id}${c.piece?.owner === 'P' ? `(${PIECES_BY_ID[c.piece.defId].name} G${c.piece.grade})` : ''}`).join(', ') || '자리 없음';
    this.addLog(`${m.label} 탈출 결과 · ${T.name} ${leak.count} → ${where}`, 'event');
  }

  // ───────── 웨이브 해석: 몬스터가 한 마리씩 죽거나 탈출할 때까지 한 바퀴 ─────────
  _resolveWave() {
    if (this.phase !== 'trial') return;
    this.sub = 'wave'; this.waveLast = [];
    this.addLog(`── 웨이브 ${this.turn} 방출 · ${this.waveSummary()} ──`, 'event');
    let kills = 0, escapes = 0; const leaked = [];
    for (const m of [...this.monsters]) {
      this.addLog(`${m.label} 출발`, 'action');
      const r = resolveLap(this.board, m);
      for (const e of r.events) this.addLog(e.text, e.type);
      this.monsters = this.monsters.filter(x => x !== m);
      this.waveLast.push({ uid: m.uid, name: m.name, mark: m.mark, damage: r.damage, killedAt: r.killedAt, escaped: r.escaped, stops: r.stops });
      if (r.killedAt !== null) { kills++; this.kills++; }
      else { escapes++; this.escapes++; if (m.boss) { this._finish('defeat', `✕ ${m.name} 탈출. 보스를 놓쳤다. 패배.`); return; } this.addLog(`${m.label} 탈출`, 'event'); leaked.push(m); }
    }
    for (const m of leaked) this._leak(m); // 탈출 결과(타락)는 웨이브가 끝난 뒤 한꺼번에 — 같은 웨이브의 뒷 마리 경로가 무작위 배치에 흔들리지 않아 프리뷰가 정확히 맞는다
    if (this.isBossWave()) { this._finish('victory', '★ 마지막 웨이브 격파. 승리.'); return; }
    this.addLog(`웨이브 ${this.turn} 종료 · 처치 ${kills} 탈출 ${escapes} → 내 턴`, 'event');
    this._startPlayerTurn();
  }

  // ───────── 테스트 훅 ─────────
  _forceUp(indices) { indices.forEach((up, i) => { if (this.dice[i]) { this.dice[i].upIndex = up; this.dice[i].pipBonus = 0; } }); }
}
