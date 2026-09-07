// TnD 결합 데모 렌더러 (v2.2) — 정비(각인+면 스킬+기물덱) / 고행(마름모 보드·웨이브 프리뷰·구간 이동·밟음 한정 업그레이드) / 순차 로그(속도 조절)
import { OPPOSITE, GRADE_LABEL, condLabel } from './config.js';
import { faceState } from './game.js';
import {
  TND, CORRUPT_TYPES, ENGRAVINGS, ENGRAVINGS_BY_ID, ENGRAVING_KIND_LABEL, ENGRAVING_DETAILS, MOVE_MODE_LABEL,
  TND_SKILLS, TND_SKILLS_BY_ID, TND_SKILL_DETAILS, TND_LAYER_LABEL, PIECES, PIECES_BY_ID, PIECE_DETAILS, TIER_LABEL, sellPrice,
} from './tnd-config.js';

const MARK = ['①', '②', '③'];
const TND_LOG_MS = 95;
const LAYERS = ['all', 'active', 'opposite', 'side', 'latent'];
const KINDS = ['all', 'move', 'roll', 'settle', 'board'];
const TIERS = ['all', 1, 2, 3, 4, 5];
const BOARD_PX = 800, R = 380, C = BOARD_PX / 2; // 마름모 반지름 380: 중앙 주사위 판(≤408×326)이 어느 칸과도 겹치지 않는 크기 (큰 기물 칸 66×54 포함)
const CORNERS = [[C, C + R], [C - R, C], [C, C - R], [C + R, C]];
function cellXY(id) { const side = Math.floor(id / 8), t = (id % 8) / 8; const [x1, y1] = CORNERS[side], [x2, y2] = CORNERS[(side + 1) % 4]; return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]; }
const chips = s => `<span class="chip chip-${s.layer}">${TND_LAYER_LABEL[s.layer]}</span><span class="chip chip-${s.grade}">${GRADE_LABEL[s.grade]}</span><span class="cond">[${condLabel(s.cond)}]</span>`;
const echip = e => `<span class="chip chip-k-${e.kind}">${ENGRAVING_KIND_LABEL[e.kind]}</span>${e.moveMode ? `<span class="cond">${MOVE_MODE_LABEL[e.moveMode]}</span>` : ''}`;
const opClass = s => s.op === 'mul' ? 'op-mul' : 'op-add';
const pieceLabel = p => `<span class="tier t${p.tier}">${TIER_LABEL[p.tier]}</span> ${p.name}`;
const pieceState = (cell) => cell.piece?.defId === 'gate' ? ` · 닫힘 ${cell.piece.charges || 0}` : '';
const STATE_LABEL = { active: '활성', opposite: '맞은편', side: '측면' };
const CAUSE_ICON = { gate: '▮', decoy: '⚑', passage: '⇄' }; const CAUSE_LABEL = { gate: '성문', decoy: '미끼', passage: '통로' };
const LOG_SPEEDS = [{ n: 1, label: '1×' }, { n: 4, label: '4×' }, { n: 0, label: '즉시' }];
const fmtEff = (op, n) => `${op === 'add' ? '+' : '×'}${Number.isInteger(n) ? n : Math.round(n * 1000) / 1000}`;

export class TndRenderer {
  constructor(game, root) {
    this.game = game; this.root = root;
    this.layerFilter = 'all'; this.kindFilter = 'all'; this.tierFilter = 'all';
    this.lastLogLength = 0; this.logQueue = []; this.upgradeFor = null; this.upgradeTarget = null; this.planOn = false; this.logSpeed = 0;
    game.onChange = () => this.render();
    this._skeleton();
    this.ticker = setInterval(() => this._tickLog(), TND_LOG_MS);
    this.render();
  }

  _skeleton() {
    this.root.innerHTML = `
      <div id="prep-screen" class="screen">
        <div id="prep-left">
          <div class="card panel-title">정비 — 주사위 관리 <span class="panel-sub">각인 슬롯/스킬 면 우클릭 회수 · ◀ ▶ 계산 순서 · 눈 ± 무제한</span></div>
          <div id="dice-select"></div>
          <div id="net-area" class="card"></div>
        </div>
        <div id="prep-right">
          <div id="engraving-list" class="card"></div>
          <div id="skill-list" class="card"></div>
          <div id="deck-panel" class="card"></div>
          <button id="btn-start" class="btn btn-red big">고행 시작</button>
          <button id="btn-title" class="btn btn-blue">타이틀로</button>
        </div>
      </div>
      <div id="trial-screen" class="screen">
        <div id="topbar" class="card"></div>
        <div id="trial-main">
          <div id="board-wrap"><div id="board"></div><div id="dice-panel" class="card"></div></div>
          <div id="trial-right">
            <div id="intent-panel" class="card"></div>
            <div id="log-panel" class="card dark"><div class="log-title">로그 <button id="btn-logspeed" class="btn btn-blue tiny" title="로그 출력 속도 (결과에는 영향 없음)">1×</button></div><div id="log-body"></div></div>
            <div id="trial-btns"><button id="btn-deckinfo" class="btn btn-blue">덱 정보</button><button id="btn-plan" class="btn btn-blue">경로 계획</button></div>
          </div>
        </div>
        <div id="dialog-overlay"><div id="dialog-card" class="card"></div></div>
        <div id="end-overlay"><div class="card end-card"><div id="end-title"></div><div id="end-desc"></div><button id="btn-back" class="btn btn-red big">정비로 복귀</button></div></div>
        <div id="deckinfo-overlay"><div id="deckinfo-card" class="card"><div id="codex-head"><span class="panel-title">덱 정보</span><button id="btn-deckinfo-close" class="btn btn-red">닫기 ✕</button></div><div id="deckinfo-body"></div></div></div>
      </div>
      <div id="tooltip"></div>`;
    const q = s => this.root.querySelector(s);
    q('#btn-start').addEventListener('click', () => this.game.startTrial());
    q('#btn-title').addEventListener('click', () => location.reload());
    q('#btn-back').addEventListener('click', () => this.game.backToPrep());
    q('#btn-deckinfo').addEventListener('click', () => { this._renderDeckInfo(); q('#deckinfo-overlay').classList.add('open'); });
    q('#btn-deckinfo-close').addEventListener('click', () => q('#deckinfo-overlay').classList.remove('open'));
    q('#btn-plan').addEventListener('click', () => { this.planOn = !this.planOn; this.render(); });
    q('#btn-logspeed').addEventListener('click', () => { this.logSpeed = (this.logSpeed + 1) % LOG_SPEEDS.length; q('#btn-logspeed').textContent = LOG_SPEEDS[this.logSpeed].label; });
    // 보드 위임: 행동·건설 단계에서 이번 턴 밟은 내 기물 클릭 → 업그레이드 창
    q('#board').addEventListener('click', (e) => {
      const el = e.target.closest('[data-tipcell]'); if (!el) return;
      const g = this.game; const id = Number(el.dataset.tipcell);
      if (g.phase === 'trial' && (g.sub === 'build' || g.sub === 'act') && g.upgradeInfo(id)) { this.upgradeFor = id; this.upgradeTarget = null; this._renderDialog(); }
    });
    // 툴팁 / 호버 프리뷰 위임
    const tip = q('#tooltip');
    this.root.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tipskill],[data-tipengr],[data-tippiece],[data-tipcell],[data-die],[data-wp]');
      if (!el) return;
      if (el.dataset.die !== undefined && this.game.sub === 'act') this._hoverPreview(Number(el.dataset.die));
      if (el.dataset.wp !== undefined) this._highlightWave(true, Number(el.dataset.wp));
      let html = null;
      if (el.dataset.tipskill) { const s = TND_SKILLS_BY_ID[el.dataset.tipskill]; html = `<b>${s.name}</b> ${chips(s)}<div>${TND_SKILL_DETAILS[s.id]}</div>`; }
      else if (el.dataset.tipengr) { const en = ENGRAVINGS_BY_ID[el.dataset.tipengr]; html = `<b>${en.name}</b> ${echip(en)}<div>${ENGRAVING_DETAILS[en.id]}</div>`; }
      else if (el.dataset.tippiece) { const p = PIECES_BY_ID[el.dataset.tippiece]; html = `<b>${pieceLabel(p)}</b> <span class="cond">비용 ${p.cost}${p.pair ? ' ×2' : ''} · ${p.verb}</span><div>${p.desc}</div><div class="tip-detail">${PIECE_DETAILS[p.id]}<br>업그레이드: 이번 턴 밟은 칸 등급당 ${Math.ceil(p.cost / 2)}, 멈춘 칸 ${Math.ceil(p.cost / 4)} · 판매 = 비용×G÷2</div>`; }
      else if (el.dataset.tipcell) html = this._cellTip(Number(el.dataset.tipcell));
      if (!html) return;
      tip.innerHTML = html; tip.classList.add('show');
      const r = el.getBoundingClientRect(); const tw = tip.offsetWidth, th = tip.offsetHeight;
      const x = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8)); let y = r.top - th - 10; if (y < 8) y = r.bottom + 10;
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    });
    this.root.addEventListener('mouseout', (e) => {
      const el = e.target.closest('[data-tipskill],[data-tipengr],[data-tippiece],[data-tipcell],[data-die],[data-wp]');
      if (!el) return;
      tip.classList.remove('show');
      if (el.dataset.die !== undefined) this._clearPreview();
      if (el.dataset.wp !== undefined) this._highlightWave(false, Number(el.dataset.wp));
    });
  }
  _cellTip(id) {
    const g = this.game; const c = g.board[id];
    let s = `<b>칸 ${id}${id === 0 ? ' (시작칸 · 몬스터 출발/탈출)' : ''}</b><div>`;
    if (c.piece) s += c.piece.owner === 'P' ? `내 기물 ${PIECES_BY_ID[c.piece.defId].name} G${c.piece.grade}${pieceState(c)} — ${PIECES_BY_ID[c.piece.defId].desc}<br>` : `사악한 기물 G${c.piece.grade} · 강제지불 ${g.finalEnemyCost(c)}<br>`;
    if (c.corrupt) { const T = CORRUPT_TYPES[c.corrupt.type] || CORRUPT_TYPES.erode; s += `타락 · ${T.name} · 카운터 ${c.corrupt.counter} — ${T.desc}<br>`; }
    if (!c.piece && !c.corrupt) s += '빈 칸<br>';
    const up = g.upgradeInfo(id); if (up) s += `<span class="op-add">이번 턴 ${up.stopped ? '멈춘 칸 · 반값' : '밟은 칸'} → 업그레이드 등급당 ${up.perLevel}</span><br>`;
    else if (c.piece?.owner === 'P' && g.player) s += '<span class="cond">이번 턴 지나가지 않아 업그레이드 불가</span><br>';
    if (g.player?.pos === id) s += '● 내 말 · ';
    for (const m of g.monsters) if (m.pos === id) s += `${m.def.icon} ${m.name} ${m.hp} · `;
    return s + '</div>';
  }
  _hoverPreview(i) {
    const pv = this.game.previewSegment(i); if (!pv) return;
    for (const p of pv.path) { const el = this.root.querySelector(`[data-tipcell="${p.cell}"]`); if (!el) continue; if (p.stop) el.classList.add('prev-stop'); else if (p.pass) el.classList.add('prev-pass'); else el.classList.add('prev-through'); }
  }
  _clearPreview() { this.root.querySelectorAll('.prev-stop,.prev-pass,.prev-through').forEach(el => el.classList.remove('prev-stop', 'prev-pass', 'prev-through')); }
  _highlightWave(on, uid) { // 프리뷰 블록 호버: 그 몬스터의 경로(밟음)와 멈춤 칸만 강조
    const pv = this.game.wavePreview(); const row = pv?.rows.find(r => r.uid === uid); if (!row) return;
    for (const p of row.path) { const el = this.root.querySelector(`[data-tipcell="${p.cell}"]`); if (!el) continue; if (p.pass) el.classList.toggle('intent-path', on); if (p.stop) el.classList.toggle('intent-focus', on); }
  }

  render() {
    const g = this.game;
    const show = (sel, on) => { this.root.querySelector(sel).style.display = on ? '' : 'none'; };
    show('#prep-screen', g.phase === 'prep'); show('#trial-screen', g.phase !== 'prep');
    if (g.phase === 'prep') this._renderPrep(); else this._renderTrial();
    this._queueLog();
  }

  // ───────── 정비 ─────────
  _renderPrep() {
    const g = this.game;
    const sel = this.root.querySelector('#dice-select');
    sel.innerHTML = g.dice.map((d, i) => {
      let add = 0, mul = 0, empty = 0;
      for (const f of d.faces) { if (!f.skill) empty++; else if (TND_SKILLS_BY_ID[f.skill.id].op === 'mul') mul++; else add++; }
      const en = d.engraving ? ENGRAVINGS_BY_ID[d.engraving] : null;
      const canDrop = g.selectedEngraving && g.canEngrave(g.selectedEngraving, i);
      return `<div class="die-card-wrap">
        <div class="order-ctl"><button class="order-btn" data-move-left="${i}" ${i === 0 ? 'disabled' : ''}>◀</button><span class="die-order">${MARK[i]}</span><button class="order-btn" data-move-right="${i}" ${i === g.dice.length - 1 ? 'disabled' : ''}>▶</button></div>
        <button class="engr-slot ${en ? 'filled' : ''} ${canDrop ? 'droppable' : ''}" data-engr-slot="${i}" ${en ? `data-tipengr="${en.id}"` : ''}>${en ? `${en.name} <small>${ENGRAVING_KIND_LABEL[en.kind]}${en.moveMode ? ` · ${MOVE_MODE_LABEL[en.moveMode]}` : ''}</small>` : '각인 슬롯 (비어 있음)'}</button>
        <button class="die mini ${g.selectedDie === i ? 'selected' : ''}" data-sel-die="${i}">
          <div class="die-no">주사위 ${i + 1}</div><div class="die-face">${d.faces.map(f => f.pip).join(' ')}</div>
          <div class="die-badge"><span class="op-add">+${add}</span> · <span class="op-mul">×${mul}</span> · 빈면 ${empty}</div></button></div>`;
    }).join('');
    sel.querySelectorAll('[data-sel-die]').forEach(b => b.addEventListener('click', () => g.selectDie(Number(b.dataset.selDie))));
    sel.querySelectorAll('[data-move-left]').forEach(b => b.addEventListener('click', () => g.moveDie(Number(b.dataset.moveLeft), -1)));
    sel.querySelectorAll('[data-move-right]').forEach(b => b.addEventListener('click', () => g.moveDie(Number(b.dataset.moveRight), 1)));
    sel.querySelectorAll('[data-engr-slot]').forEach(b => {
      b.addEventListener('click', () => { const i = Number(b.dataset.engrSlot); if (g.selectedEngraving) g.engrave(g.selectedEngraving, i); else g.selectDie(i); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); g.unengrave(Number(b.dataset.engrSlot)); });
    });

    const net = this.root.querySelector('#net-area');
    if (g.selectedDie === null) net.innerHTML = '<div class="net-hint">주사위를 선택하면 전개도가 펼쳐집니다.</div>';
    else {
      const die = g.dice[g.selectedDie]; const opp = g.selectedFace !== null ? OPPOSITE[g.selectedFace] : null; const en = die.engraving ? ENGRAVINGS_BY_ID[die.engraving] : null;
      const layout = [[0, 1, 1], [1, 0, 3], [1, 1, 0], [1, 2, 2], [1, 3, 4], [2, 1, 5]];
      const cells = layout.map(([r, c, f]) => {
        const inst = die.faces[f].skill; const s = inst ? TND_SKILLS_BY_ID[inst.id] : null;
        const ok = g.selectedSkill && g.canEquip(g.selectedSkill, g.selectedDie, f);
        const gongheo = s && en?.id === 'gongheo' && s.layer !== 'active' ? ' <span class="op-mul">(×2)</span>' : '';
        return `<button class="net-face ${g.selectedFace === f ? 'selected' : ''} ${opp === f ? 'opp-mark' : ''} ${ok ? 'equippable' : ''} ${g.selectedSkill && !ok ? 'dim' : ''}" data-face="${f}" ${s ? `data-tipskill="${s.id}"` : ''} style="grid-row:${r + 1};grid-column:${c + 1}">
          <div class="net-slot">F${f + 1}</div><div class="die-face">${die.faces[f].pip}</div>
          <div class="die-skill">${s ? `<span class="lay-${s.layer}">${s.name}</span> ${s.desc}${gongheo}` : '&nbsp;'}</div>${opp === f ? '<div class="opp-label">맞은편</div>' : ''}</button>`;
      }).join('');
      const ctl = g.selectedFace === null ? '<div class="net-hint">면을 선택하세요. 스킬 목록에서 스킬을 고르면 장착 가능한 면이 강조됩니다.</div>' : `
        <div id="face-ctl"><span>F${g.selectedFace + 1} 눈 변경:</span><button id="btn-minus" class="btn btn-blue" ${die.faces[g.selectedFace].pip <= 1 ? 'disabled' : ''}>−1</button><button id="btn-plus" class="btn btn-blue" ${die.faces[g.selectedFace].pip >= 6 ? 'disabled' : ''}>+1</button></div>`;
      net.innerHTML = `<div class="net-title">주사위 ${g.selectedDie + 1} · 각인: ${en ? `<b>${en.name}</b> — ${en.desc}` : '없음'}</div><div class="net-grid">${cells}</div>${ctl}`;
      net.querySelectorAll('[data-face]').forEach(b => {
        b.addEventListener('click', () => { const f = Number(b.dataset.face); if (g.selectedSkill && g.canEquip(g.selectedSkill, g.selectedDie, f)) g.equip(g.selectedSkill, g.selectedDie, f); else g.selectFace(f); });
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); g.unequip(g.selectedDie, Number(b.dataset.face)); });
      });
      net.querySelector('#btn-plus')?.addEventListener('click', () => g.changePip(g.selectedDie, g.selectedFace, 1));
      net.querySelector('#btn-minus')?.addEventListener('click', () => g.changePip(g.selectedDie, g.selectedFace, -1));
    }

    // 각인 목록
    const engEq = g.equippedEngravingIds();
    const el = this.root.querySelector('#engraving-list');
    el.innerHTML = `<div class="panel-title">각인 목록 (${ENGRAVINGS.length}) <span class="panel-sub">주사위당 1개 · 클릭 후 각인 슬롯 클릭</span></div>
      <div class="filter-row">${KINDS.map(k => `<button class="chip-btn ${this.kindFilter === k ? 'on' : ''}" data-kind="${k}">${k === 'all' ? '전체' : ENGRAVING_KIND_LABEL[k]}</button>`).join('')}</div>
      <div class="list-items short">${ENGRAVINGS.filter(e => this.kindFilter === 'all' || e.kind === this.kindFilter).map(e => `<button class="inv-skill ${engEq.has(e.id) ? 'equipped' : ''} ${g.selectedEngraving === e.id ? 'picked' : ''}" data-engr="${e.id}" data-tipengr="${e.id}"><b>${e.name}</b> ${echip(e)} ${engEq.has(e.id) ? '<span class="eq-mark">장착됨</span>' : ''}<div class="desc">${e.desc}</div></button>`).join('')}</div>`;
    el.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { this.kindFilter = b.dataset.kind; this.render(); }));
    el.querySelectorAll('[data-engr]').forEach(b => b.addEventListener('click', () => { if (!engEq.has(b.dataset.engr)) g.selectEngraving(b.dataset.engr); }));

    // 면 스킬 목록
    const equipped = g.equippedSkillIds(); const faceSel = g.selectedDie !== null && g.selectedFace !== null;
    const list = this.root.querySelector('#skill-list');
    list.innerHTML = `<div class="panel-title">면 스킬 목록 (${TND_SKILLS.length}) <span class="panel-sub">장착 ${equipped.size}</span></div>
      <div class="filter-row">${LAYERS.map(l => `<button class="chip-btn ${this.layerFilter === l ? 'on' : ''}" data-layer="${l}">${l === 'all' ? '전체' : TND_LAYER_LABEL[l]}</button>`).join('')}</div>
      <div class="list-items">${TND_SKILLS.filter(s => this.layerFilter === 'all' || s.layer === this.layerFilter).map(s => {
        const isEq = equipped.has(s.id); const can = faceSel ? g.canEquip(s.id, g.selectedDie, g.selectedFace) : true;
        return `<button class="inv-skill ${isEq ? 'equipped' : ''} ${!isEq && !can ? 'disabled' : ''} ${g.selectedSkill === s.id ? 'picked' : ''}" data-skill="${s.id}" data-tipskill="${s.id}"><b>${s.name}</b> ${chips(s)} ${isEq ? '<span class="eq-mark">장착됨</span>' : ''}<div class="desc ${opClass(s)}">${s.desc}</div></button>`;
      }).join('')}</div>`;
    list.querySelectorAll('[data-layer]').forEach(b => b.addEventListener('click', () => { this.layerFilter = b.dataset.layer; this.render(); }));
    list.querySelectorAll('[data-skill]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.skill; if (equipped.has(id)) return; if (faceSel && g.canEquip(id, g.selectedDie, g.selectedFace)) g.equip(id, g.selectedDie, g.selectedFace); else g.selectSkill(id); }));

    // 기물덱
    const deck = this.root.querySelector('#deck-panel');
    deck.innerHTML = `<div class="panel-title">기물덱 (${g.deck.length}/${TND.DECK_SIZE}) <span class="panel-sub">우클릭으로 제거</span></div>
      <div id="deck-slots">${Array.from({ length: TND.DECK_SIZE }, (_, i) => g.deck[i] ? `<button class="deck-slot filled" data-slot="${i}" data-tippiece="${g.deck[i]}">${pieceLabel(PIECES_BY_ID[g.deck[i]])}<small>${PIECES_BY_ID[g.deck[i]].cost}</small></button>` : '<div class="deck-slot"></div>').join('')}</div>
      <div class="panel-title small">기물 목록 (${PIECES.length})</div>
      <div class="filter-row">${TIERS.map(t => `<button class="chip-btn ${this.tierFilter === t ? 'on' : ''}" data-tier="${t}">${t === 'all' ? '전체' : TIER_LABEL[t]}</button>`).join('')}</div>
      <div id="piece-items">${PIECES.filter(p => this.tierFilter === 'all' || p.tier === this.tierFilter).map(p => `<button class="piece-item ${g.deck.length >= TND.DECK_SIZE ? 'disabled' : ''}" data-piece="${p.id}" data-tippiece="${p.id}">${pieceLabel(p)} <span class="cond">${p.cost}</span></button>`).join('')}</div>`;
    deck.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('contextmenu', (e) => { e.preventDefault(); g.deckRemove(Number(b.dataset.slot)); }));
    deck.querySelectorAll('[data-piece]').forEach(b => b.addEventListener('click', () => g.deckAdd(b.dataset.piece)));
    deck.querySelectorAll('[data-tier]').forEach(b => b.addEventListener('click', () => { this.tierFilter = b.dataset.tier === 'all' ? 'all' : Number(b.dataset.tier); this.render(); }));
    const start = this.root.querySelector('#btn-start'); start.disabled = !g.canStart();
    start.textContent = g.canStart() ? '고행 시작' : `고행 시작 (기물덱 ${TND.DECK_SIZE}장 필요)`;
  }

  // ───────── 고행 ─────────
  _renderTrial() {
    const g = this.game;
    const gauge = Array.from({ length: TND.GAUGE }, (_, i) => `<span class="gcell ${i < g.player.gauge ? 'on' : ''}"></span>`).join('');
    const left = g.waveCount() - g.turn;
    this.root.querySelector('#topbar').innerHTML = `
      <span>웨이브 <b>${g.turn}</b>/${g.waveCount()}${g.isBossWave() ? ' <span class="boss-tag">보스</span>' : ''}</span><span>신앙 <b class="op-add">${g.player.faith}</b></span>
      <span>탈출 <b class="op-mul">${g.escapes}</b> · 처치 ${g.kills} · 타락 <b>${g.corruptCount()}</b>칸 · 사악한 기물 ${g.enemyPieceCount()}</span>
      <span>${left > 0 ? `보스까지 <b>${left}</b>` : '<b class="op-mul">보스 웨이브</b>'}</span>
      <span class="gauge">${gauge} <small>${g.player.gauge}/${TND.GAUGE}</small></span>`;
    this._renderWavePanel(); this._renderBoard(); this._renderDicePanel(); this._renderDialog();
    this.root.querySelector('#btn-plan').classList.toggle('on', this.planOn);
    const end = this.root.querySelector('#end-overlay'); end.classList.toggle('open', g.phase === 'end');
    if (g.phase === 'end') { this.root.querySelector('#end-title').textContent = g.result === 'victory' ? '승리!' : '패배'; this.root.querySelector('#end-desc').textContent = g.result === 'victory' ? `웨이브 ${g.waveCount()} 격파 · 처치 ${g.kills} · 탈출 ${g.escapes}` : `웨이브 ${g.turn} · ${g.log[g.log.length - 1]?.text || ''}`; }
  }
  _renderWavePanel() {
    const g = this.game; const pv = g.wavePreview();
    const panel = this.root.querySelector('#intent-panel');
    if (!pv) { panel.innerHTML = `<div class="panel-title">웨이브 ${g.turn} 진행 중</div>`; return; }
    const rows = pv.rows.map(r => {
      const changed = r.changed.map(c => `${CAUSE_ICON[c.cause]} ${CAUSE_LABEL[c.cause]}→${c.cell}`).join(' ');
      const hp = Math.max(0, Math.round(r.remaining / r.maxHp * 100));
      return `<div class="wp-row ${r.escaped ? 'bad' : 'ok'}" data-wp="${r.uid}">
        <div class="wp-main"><span class="mon-icon">${r.icon}</span>${r.name} ${r.mark}${r.boss ? ' <span class="boss-tag">보스</span>' : ''} <b>HP ${r.hp}</b><span class="hpbar"><span style="width:${hp}%"></span></span>
          <span class="wp-verdict ${r.escaped ? 'op-mul' : 'op-add'}">${r.escaped ? `✗ 탈출 · 부족 ${r.remaining}` : `✓ 처치 (칸 ${r.killedAt})`}</span></div>
        <div class="wp-sub">예상 피해 <b>${r.damage}</b> · ${MOVE_MODE_LABEL[r.moveMode]} ${r.pattern.join('·')} · ${r.leakText}</div>
        <div class="wp-sub">멈춤 ${r.stops.length ? r.stops.join('·') : '없음'}${changed ? ` · <span class="op-mul">${changed}</span>` : ''}</div></div>`;
    }).join('');
    panel.innerHTML = `<div class="panel-title">웨이브 ${g.turn} 프리뷰 <span class="panel-sub">현재 보드 기준 · 기물을 짓거나 올리면 즉시 갱신 · 블록 호버: 경로</span></div>${rows}`;
  }
  _renderBoard() {
    const g = this.game; const pv = g.wavePreview();
    const plan = new Set(this.planOn && g.sub === 'act' ? g.routePlan() : []);
    const stars = new Map(); const causes = new Map();
    for (const r of pv?.rows || []) { for (const c of r.stops) stars.set(c, (stars.get(c) || 0) + 1); for (const ch of r.changed) causes.set(ch.cell, ch.cause); }
    const canUp = g.sub === 'act' || g.sub === 'build';
    this.root.querySelector('#board').innerHTML = g.board.map(c => {
      const [x, y] = cellXY(c.id);
      const def = c.piece?.owner === 'P' ? PIECES_BY_ID[c.piece.defId] : null;
      const here = g.monsters.filter(m => m.pos === c.id);
      const up = canUp && def ? g.upgradeInfo(c.id) : null;
      const cls = ['cell', c.piece ? `owner-${c.piece.owner}` : '', c.corrupt ? 'corrupt' : '', c.id === 0 ? 'start' : '',
        stars.has(c.id) ? 'intent-stop' : '', plan.has(c.id) ? 'plan' : '', plan.has(c.id) && stars.has(c.id) ? 'plan-hit' : '', def && def.tier >= 4 ? `big t${def.tier}` : '',
        up ? 'upgradable' : '', canUp && def && !up ? 'no-up' : ''].join(' ');
      const label = def ? `<i>${TIER_LABEL[def.tier]}</i> ${def.name}<b>G${c.piece.grade}${def.id === 'gate' ? `<small> ${c.piece.charges || 0}</small>` : ''}</b>` : c.piece ? `사악<b>G${c.piece.grade}</b>` : (c.id === 0 ? '시작' : '');
      const T = c.corrupt ? (CORRUPT_TYPES[c.corrupt.type] || CORRUPT_TYPES.erode) : null;
      return `<div class="${cls}" style="left:${x}px;top:${y}px" data-tipcell="${c.id}">
        <span class="cid">${c.id}</span><span class="clabel">${label}</span>
        ${T ? `<span class="ccount">${T.name} ${c.corrupt.counter}</span>` : ''}${stars.has(c.id) ? `<span class="star">★${stars.get(c.id) > 1 ? `<i>×${stars.get(c.id)}</i>` : ''}${causes.has(c.id) ? `<em>${CAUSE_ICON[causes.get(c.id)]}</em>` : ''}</span>` : ''}${plan.has(c.id) ? '<span class="plan-dot">•</span>' : ''}
        ${up ? `<span class="up-mark ${up.stopped ? 'half' : ''}">${up.stopped ? '½' : '↑'}</span>` : ''}
        ${g.player.pos === c.id ? '<span class="pawn p">●</span>' : ''}${here.length ? `<span class="pawn e">${here.map(m => `<span class="mon"><small>${Math.max(0, m.hp)}</small>${m.def.icon}</span>`).join('')}</span>` : ''}</div>`;
    }).join('');
  }
  _renderDicePanel() {
    const g = this.game; const panel = this.root.querySelector('#dice-panel');
    const rolling = g.sub === 'roll', acting = g.sub === 'act', building = g.sub === 'build';
    const fs = g.faceStatus();
    const dice = g.dice.map((d, i) => {
      const en = d.engraving ? ENGRAVINGS_BY_ID[d.engraving] : null;
      const used = g.usedDice.includes(i); const { mode } = g.moveModeOf(d); const st = fs[i];
      // 면 상태: 활성 → 맞은편 → 측면 순서로, 발동하는 면은 ✓+효과, 아니면 흐리게 (요구 계층 표시)
      const rows = st.faces.map(f => `<div class="fs ${f.fired ? 'on' : 'off'}" data-tipskill="${f.skill.id}">
          <span class="fs-state st-${f.state}">${STATE_LABEL[f.state]}</span><span class="fs-name lay-${f.skill.layer}">${f.skill.name}</span>
          <span class="fs-eff ${f.fired ? (f.op === 'mul' ? 'op-mul' : 'op-add') : ''}">${f.fired ? `✓ ${fmtEff(f.op, f.n)}${f.note ? '<i>공허</i>' : ''}` : f.layerOk ? '조건 ✕' : `${TND_LAYER_LABEL[f.skill.layer]}면만`}</span></div>`)
        .concat(st.engr.map(x => `<div class="fs on engr"><span class="fs-state st-engr">각인</span><span class="fs-name">${x.name}</span><span class="fs-eff ${x.op === 'mul' ? 'op-mul' : 'op-add'}">✓ ${fmtEff(x.op, x.n)}</span></div>`)).join('');
      return `<div class="die small ${d.locked ? 'locked' : ''} ${acting && !used ? 'moveable' : ''} ${used ? 'used' : ''}" data-die="${i}">
        <div class="die-order">${MARK[i]}</div>
        <div class="die-engr ${en ? `k-${en.kind}` : ''}" ${en ? `data-tipengr="${en.id}"` : ''}>${en ? en.name : '—'} <small>${MOVE_MODE_LABEL[mode]}</small></div>
        <div class="die-face">${g.activePip(d)}${d.pipBonus ? `<small>+${d.pipBonus}</small>` : ''}</div>
        ${d.locked ? '<div class="lock-badge">잠금</div>' : ''}
        <div class="die-faces"><div class="fs-head">발동 ${st.firedCount}/${st.faces.length + st.engr.length}</div>${rows || '<div class="fs none">면 스킬 없음</div>'}</div></div>`;
    }).join('');
    const pv = g.wavePreview();
    let status = '';
    if (rolling) { const p = g.preview(); status = `<div class="preview">신앙치 <b>${p.points}</b> → 신앙 <b class="op-add">+${p.faith}</b> <small>(잔량 ${p.gauge})</small></div>`; }
    else if (acting) status = `<div class="preview">구간 ${g.usedDice.length + 1}/3 · 주사위를 클릭해 이동 (호버: 경유·도착 프리뷰) · 밟은 기물(↑/½)은 지금도 업그레이드 가능</div>`;
    else if (building) status = `<div class="preview">이동 완료 — 밟은 기물(↑ 정가 · ½ 반값)을 클릭해 업그레이드 · 턴 종료 = 웨이브 방출${pv?.anyEscape ? ' <b class="op-mul">(탈출 예상 있음)</b>' : ''}</div>`;
    else if (g.sub === 'wave') status = '<div class="preview">웨이브 진행 중</div>';
    else status = '<div class="preview">상호작용 창에 응답하세요</div>';
    panel.innerHTML = `<div id="trial-dice">${dice}</div>${status}
      <div id="actions"><button id="btn-roll" class="btn btn-red" ${!rolling || g.rollsLeft <= 0 ? 'disabled' : ''}>굴림 ${rolling ? g.rollsLeft : ''}</button>
      <button id="btn-confirm" class="btn btn-blue" ${!rolling ? 'disabled' : ''}>확정</button>
      <button id="btn-endturn" class="btn btn-red ${building && pv?.anyEscape ? 'warn' : ''}" ${!building ? 'disabled' : ''}>턴 종료 · 웨이브 방출</button></div>`;
    panel.querySelector('#btn-roll').addEventListener('click', () => g.reroll());
    panel.querySelector('#btn-confirm').addEventListener('click', () => g.confirm());
    panel.querySelector('#btn-endturn').addEventListener('click', () => g.endTurn());
    panel.querySelectorAll('[data-die]').forEach(el => el.addEventListener('click', () => { const i = Number(el.dataset.die); if (rolling) g.toggleLock(i); else if (acting) { this._clearPreview(); g.chooseMoveDie(i); } }));
  }
  _renderDialog() {
    const g = this.game; const ov = this.root.querySelector('#dialog-overlay'); const card = this.root.querySelector('#dialog-card');
    const p = g.pending; const up = this.upgradeFor !== null && (g.sub === 'build' || g.sub === 'act') && !p ? g.upgradeInfo(this.upgradeFor) : null;
    if (!up) this.upgradeFor = null;
    ov.classList.toggle('open', (!!p || !!up) && g.phase === 'trial');
    let html = '';
    if (p?.type === 'pay') {
      const mine = g.myPieces();
      html = `<div class="panel-title">강제지불 — 사악한 기물 G${g.board[p.pos].piece.grade}</div>
        <div class="dlg-line">비용 <b class="op-mul">${p.cost}</b> · 보유 신앙 <b>${g.player.faith}</b></div>
        <div class="dlg-actions"><button id="dlg-pay" class="btn btn-red" ${g.canPay() ? '' : 'disabled'}>지불</button>${g.mustGiveUp() ? '<button id="dlg-giveup" class="btn btn-blue">게임 포기</button>' : ''}</div>
        ${mine.length ? `<div class="dlg-sub">기물 판매 (판매가 = 비용×G÷2)</div><div class="dlg-list">${mine.map(c => `<button class="dlg-item" data-sell="${c.id}">칸 ${c.id} ${PIECES_BY_ID[c.piece.defId].name} G${c.piece.grade} → +${sellPrice(PIECES_BY_ID[c.piece.defId], c.piece.grade)}</button>`).join('')}</div>` : ''}`;
    } else if (p?.type === 'purify') {
      html = `<div class="panel-title">정화 — 칸 ${p.pos} (카운터 ${g.board[p.pos].corrupt.counter})</div><div class="dlg-line">비용 <b>${p.cost}</b> · 보유 신앙 <b>${g.player.faith}</b></div>
        <div class="dlg-actions"><button id="dlg-purify" class="btn btn-red" ${g.player.faith >= p.cost ? '' : 'disabled'}>정화</button><button id="dlg-skip" class="btn btn-blue">건너뛰기</button></div>`;
    } else if (p?.type === 'destroy') {
      html = `<div class="panel-title">파괴 — 사악한 기물 G${p.grade} (칸 ${p.pos})</div><div class="dlg-line">파괴 비용 <b class="op-mul">${p.cost}</b> (최종 비용 ×1.5) · 보유 <b>${g.player.faith}</b> · 파괴 후 건설 가능</div>
        <div class="dlg-actions"><button id="dlg-destroy" class="btn btn-red" ${g.player.faith >= p.cost ? '' : 'disabled'}>파괴</button><button id="dlg-skip" class="btn btn-blue">건너뛰기</button></div>`;
    } else if (p?.type === 'build') {
      html = `<div class="panel-title">건설 — 칸 ${p.pos}${p.discount ? ' <span class="op-add">(개척 −30%)</span>' : ''}</div><div class="dlg-line">보유 신앙 <b>${g.player.faith}</b></div>
        <div class="dlg-list">${g.deck.map(id => `<button class="dlg-item ${g.player.faith < g.buildCost(id) ? 'disabled' : ''}" data-build="${id}" data-tippiece="${id}">${pieceLabel(PIECES_BY_ID[id])} · ${g.buildCost(id)}</button>`).join('')}</div>
        <div class="dlg-actions"><button id="dlg-skip" class="btn btn-blue">건너뛰기</button></div>`;
    } else if (p?.type === 'passage') {
      html = `<div class="panel-title">통로 — 칸 ${p.pos} ⇄ 칸 ${p.to}</div><div class="dlg-line">다른 통로(칸 ${p.to})로 순간이동할까요? 사이 칸은 밟지 않고, 도착한 통로는 멈춘 칸으로 칩니다.</div>
        <div class="dlg-actions"><button id="dlg-passage-go" class="btn btn-red">이동</button><button id="dlg-passage-stay" class="btn btn-blue">머무름</button></div>`;
    } else if (p?.type === 'release') {
      html = `<div class="panel-title">웨이브 방출 — 탈출 예상</div><div class="dlg-line">현재 보드로는 <b class="op-mul">${p.names.join(', ')}</b>이(가) 탈출합니다.${p.boss ? ' <b class="op-mul">보스 탈출 = 패배!</b>' : ' 탈출한 몬스터는 타락을 남깁니다.'}</div>
        <div class="dlg-actions"><button id="dlg-release" class="btn btn-red">그래도 방출</button><button id="dlg-release-cancel" class="btn btn-blue">돌아가서 보강</button></div>`;
    } else if (up) {
      if (this.upgradeTarget === null || this.upgradeTarget <= up.grade) this.upgradeTarget = Math.min(TND.MAX_GRADE, up.grade + 1);
      const total = (this.upgradeTarget - up.grade) * up.perLevel;
      html = `<div class="panel-title">업그레이드 — 칸 ${up.pos} ${up.name} G${up.grade} ${up.stopped ? '<span class="half-badge">멈춘 칸 · 반값</span>' : '<span class="half-badge pass">밟은 칸 · 정가</span>'}</div>
        <div class="dlg-line">등급당 <b>${up.perLevel}</b> · 보유 신앙 <b>${g.player.faith}</b>${up.reload ? ' · <span class="op-add">성문: 닫힘 횟수가 새 등급으로 재장전</span>' : ''}</div>
        <div class="dlg-grades">${Array.from({ length: TND.MAX_GRADE - up.grade }, (_, k) => up.grade + 1 + k).map(t => `<button class="grade-btn ${this.upgradeTarget === t ? 'on' : ''}" data-grade="${t}">G${t}</button>`).join('')}</div>
        <div class="dlg-line">G${up.grade} → G${this.upgradeTarget} 총액 <b class="op-mul">${total}</b></div>
        <div class="dlg-actions"><button id="dlg-upgrade" class="btn btn-red" ${g.player.faith >= total ? '' : 'disabled'}>업그레이드</button><button id="dlg-close" class="btn btn-blue">닫기</button></div>`;
    }
    card.innerHTML = html;
    card.querySelector('#dlg-pay')?.addEventListener('click', () => g.payConfirm());
    card.querySelector('#dlg-giveup')?.addEventListener('click', () => g.giveUp());
    card.querySelectorAll('[data-sell]').forEach(b => b.addEventListener('click', () => g.sellPiece(Number(b.dataset.sell))));
    card.querySelector('#dlg-purify')?.addEventListener('click', () => g.purify());
    card.querySelector('#dlg-destroy')?.addEventListener('click', () => g.destroy());
    card.querySelectorAll('[data-build]').forEach(b => b.addEventListener('click', () => { if (!b.classList.contains('disabled')) g.build(b.dataset.build); }));
    card.querySelector('#dlg-passage-go')?.addEventListener('click', () => g.passageGo());
    card.querySelector('#dlg-passage-stay')?.addEventListener('click', () => g.passageStay());
    card.querySelector('#dlg-release')?.addEventListener('click', () => g.releaseConfirm());
    card.querySelector('#dlg-release-cancel')?.addEventListener('click', () => g.releaseCancel());
    card.querySelectorAll('[data-grade]').forEach(b => b.addEventListener('click', () => { this.upgradeTarget = Number(b.dataset.grade); this._renderDialog(); }));
    card.querySelector('#dlg-upgrade')?.addEventListener('click', () => { const pos = this.upgradeFor; this.upgradeFor = null; g.upgradePiece(pos, this.upgradeTarget); });
    card.querySelector('#dlg-close')?.addEventListener('click', () => { this.upgradeFor = null; this.render(); });
    card.querySelector('#dlg-skip')?.addEventListener('click', () => { if (p.type === 'purify') g.skipPurify(); else if (p.type === 'destroy') g.skipDestroy(); else if (p.type === 'build') g.skipBuild(); });
  }
  _renderDeckInfo() {
    const g = this.game;
    this.root.querySelector('#deckinfo-body').innerHTML = `<div class="deckinfo-dice">${g.dice.map((d, i) => { const en = d.engraving ? ENGRAVINGS_BY_ID[d.engraving] : null; return `<div class="card mini-net"><b>${MARK[i]} 주사위 ${i + 1} · 각인 ${en ? en.name : '없음'}</b>${d.faces.map((f, k) => { const s = f.skill ? TND_SKILLS_BY_ID[f.skill.id] : null; return `<div class="mini-face ${faceState(k, d.upIndex) === 'active' ? 'act' : ''}">F${k + 1} · ${f.pip} · ${s ? `<span class="lay-${s.layer}">${s.name}</span> ${s.desc}` : '—'}</div>`; }).join('')}</div>`; }).join('')}</div>
      <div class="panel-title small">기물덱</div><div class="dlg-list">${g.deck.map(id => `<span class="dlg-item static" data-tippiece="${id}">${pieceLabel(PIECES_BY_ID[id])} · ${PIECES_BY_ID[id].cost}</span>`).join('')}</div>`;
  }
  _queueLog() {
    const g = this.game;
    if (g.log.length < this.lastLogLength) { this.logQueue = []; this.lastLogLength = 0; this.root.querySelector('#log-body').innerHTML = ''; }
    for (let i = this.lastLogLength; i < g.log.length; i++) this.logQueue.push(g.log[i]);
    this.lastLogLength = g.log.length;
  }
  _tickLog() { // 속도: 1× = 틱당 1줄, 4× = 4줄, 즉시 = 전부. 게임 결과는 이미 확정되어 있어 속도는 표시에만 영향
    if (!this.logQueue.length) return;
    const n = LOG_SPEEDS[this.logSpeed].n || this.logQueue.length; const body = this.root.querySelector('#log-body');
    for (let k = 0; k < n && this.logQueue.length; k++) { const e = this.logQueue.shift(); const div = document.createElement('div'); div.className = `log-line log-${e.type}`; div.textContent = e.text; body.appendChild(div); }
    body.scrollTop = body.scrollHeight;
  }
}
