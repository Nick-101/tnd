// TnD 결합 데모 렌더러 — 정비 화면 / 고행 화면(마름모 보드 + 주사위 판 + 대화창) / 순차 로그
import { OPPOSITE, GRADE_LABEL, condLabel } from './config.js';
import { faceState } from './game.js';
import { TND, TND_SKILLS, TND_SKILLS_BY_ID, TND_SKILL_DETAILS, TND_LAYER_LABEL, PIECES, PIECES_BY_ID, upgradeCost, sellPrice } from './tnd-config.js';

const TND_ORDER_MARK = ['①', '②', '③', '④', '⑤'];
const TND_LOG_MS = 95;
const LAYERS = ['all', 'active', 'opposite', 'side', 'latent', 'move'];

// 마름모 보드 좌표: 32칸, 꼭짓점 0(남)·8(서)·16(북)·24(동)
const BOARD_PX = 700, R = 330, C = BOARD_PX / 2;
const CORNERS = [[C, C + R], [C - R, C], [C, C - R], [C + R, C]];
function cellXY(id) {
  const side = Math.floor(id / 8), t = (id % 8) / 8;
  const [x1, y1] = CORNERS[side], [x2, y2] = CORNERS[(side + 1) % 4];
  return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
}

function chips(s) {
  return `<span class="chip chip-${s.layer}">${TND_LAYER_LABEL[s.layer]}</span><span class="chip chip-${s.grade}">${GRADE_LABEL[s.grade]}</span><span class="cond">[${condLabel(s.cond)}]</span>`;
}
const opClass = s => s.op === 'mul' ? 'op-mul' : s.op === 'add' ? 'op-add' : 'op-move';

export class TndRenderer {
  constructor(game, root) {
    this.game = game; this.root = root;
    this.layerFilter = 'all';
    this.lastLogLength = 0; this.logQueue = [];
    this.upgradeTarget = null;
    game.onChange = () => this.render();
    this._skeleton();
    this.ticker = setInterval(() => this._tickLog(), TND_LOG_MS);
    this.render();
  }

  _skeleton() {
    this.root.innerHTML = `
      <div id="prep-screen" class="screen">
        <div id="prep-left">
          <div class="card panel-title">정비 — 주사위 관리 <span class="panel-sub">◀ ▶ 순서 변경 · 스킬 면 우클릭 회수 · 눈 ± 무제한</span></div>
          <div id="dice-select"></div>
          <div id="net-area" class="card"></div>
        </div>
        <div id="prep-right">
          <div id="skill-list" class="card"></div>
          <div id="deck-panel" class="card"></div>
          <button id="btn-start" class="btn btn-red big">고행 시작</button>
          <button id="btn-title" class="btn btn-blue">타이틀로</button>
        </div>
      </div>
      <div id="trial-screen" class="screen">
        <div id="topbar" class="card"></div>
        <div id="trial-main">
          <div id="board-wrap">
            <div id="board"></div>
            <div id="dice-panel" class="card"></div>
          </div>
          <div id="trial-right">
            <div id="log-panel" class="card dark"><div class="log-title">로그</div><div id="log-body"></div></div>
            <button id="btn-deckinfo" class="btn btn-blue">덱 정보</button>
          </div>
        </div>
        <div id="dialog-overlay"><div id="dialog-card" class="card"></div></div>
        <div id="end-overlay"><div class="card end-card"><div id="end-title"></div><div id="end-desc"></div><button id="btn-back" class="btn btn-red big">정비로 복귀</button></div></div>
        <div id="deckinfo-overlay"><div id="deckinfo-card" class="card"><div id="codex-head"><span class="panel-title">덱 정보</span><button id="btn-deckinfo-close" class="btn btn-red">닫기 ✕</button></div><div id="deckinfo-body"></div></div></div>
      </div>
      <div id="tooltip"></div>`;
    const q = sel => this.root.querySelector(sel);
    q('#btn-start').addEventListener('click', () => this.game.startTrial());
    q('#btn-title').addEventListener('click', () => location.reload());
    q('#btn-back').addEventListener('click', () => this.game.backToPrep());
    q('#btn-deckinfo').addEventListener('click', () => { this._renderDeckInfo(); q('#deckinfo-overlay').classList.add('open'); });
    q('#btn-deckinfo-close').addEventListener('click', () => q('#deckinfo-overlay').classList.remove('open'));
    // 툴팁 위임: 스킬 / 기물 / 칸
    const tip = q('#tooltip');
    this.root.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tipskill],[data-tippiece],[data-tipcell]');
      if (!el) return;
      if (el.dataset.tipskill) { const s = TND_SKILLS_BY_ID[el.dataset.tipskill]; tip.innerHTML = `<b>${s.name}</b> ${chips(s)}<div>${TND_SKILL_DETAILS[s.id]}</div>`; }
      else if (el.dataset.tippiece) { const p = PIECES_BY_ID[el.dataset.tippiece]; tip.innerHTML = `<b>${p.name}</b> <span class="cond">비용 ${p.cost} · ${p.role}</span><div>플레이어가 밟을 시: ${p.p}<br>적이 밟을 시: ${p.e}<br>업그레이드 등급당 ${upgradeCost(p)} · 판매 = ${p.cost}×G÷2 (올림)</div>`; }
      else tip.innerHTML = this._cellTip(Number(el.dataset.tipcell));
      tip.classList.add('show');
      const r = el.getBoundingClientRect(); const tw = tip.offsetWidth, th = tip.offsetHeight;
      const x = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
      let y = r.top - th - 10; if (y < 8) y = r.bottom + 10;
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    });
    this.root.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tipskill],[data-tippiece],[data-tipcell]')) tip.classList.remove('show'); });
  }

  _cellTip(id) {
    const g = this.game; const c = g.board[id];
    let s = `<b>칸 ${id}${id === 0 ? ' (시작칸)' : ''}</b><div>`;
    if (c.piece) s += c.piece.owner === 'P' ? `내 기물 ${PIECES_BY_ID[c.piece.defId].name} G${c.piece.grade}<br>` : `사악한 기물 G${c.piece.grade} · 강제지불 ${g.finalEnemyCost(c)}<br>`;
    if (c.corrupt) s += `타락 · 카운터 ${c.corrupt.counter}<br>`;
    if (!c.piece && !c.corrupt) s += '빈 칸<br>';
    if (g.player.pos === id) s += '● 내 말<br>'; if (g.enemy.pos === id) s += '■ 적 말';
    return s + '</div>';
  }

  render() {
    const g = this.game;
    const show = (sel, on) => { this.root.querySelector(sel).style.display = on ? '' : 'none'; };
    show('#prep-screen', g.phase === 'prep');
    show('#trial-screen', g.phase !== 'prep');
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
      return `<div class="die-card-wrap">
        <div class="order-ctl"><button class="order-btn" data-move-left="${i}" ${i === 0 ? 'disabled' : ''}>◀</button><span class="die-order">${TND_ORDER_MARK[i]}</span><button class="order-btn" data-move-right="${i}" ${i === g.dice.length - 1 ? 'disabled' : ''}>▶</button></div>
        <button class="die mini ${g.selectedDie === i ? 'selected' : ''}" data-sel-die="${i}">
          <div class="die-no">주사위 ${i + 1}</div><div class="die-face">${d.faces.map(f => f.pip).join(' ')}</div>
          <div class="die-badge"><span class="op-add">+${add}</span> · <span class="op-mul">×${mul}</span> · 빈면 ${empty}</div></button></div>`;
    }).join('');
    sel.querySelectorAll('[data-sel-die]').forEach(b => b.addEventListener('click', () => g.selectDie(Number(b.dataset.selDie))));
    sel.querySelectorAll('[data-move-left]').forEach(b => b.addEventListener('click', () => g.moveDie(Number(b.dataset.moveLeft), -1)));
    sel.querySelectorAll('[data-move-right]').forEach(b => b.addEventListener('click', () => g.moveDie(Number(b.dataset.moveRight), 1)));

    const net = this.root.querySelector('#net-area');
    if (g.selectedDie === null) net.innerHTML = '<div class="net-hint">주사위를 선택하면 전개도가 펼쳐집니다.</div>';
    else {
      const die = g.dice[g.selectedDie]; const opp = g.selectedFace !== null ? OPPOSITE[g.selectedFace] : null;
      const layout = [[0, 1, 1], [1, 0, 3], [1, 1, 0], [1, 2, 2], [1, 3, 4], [2, 1, 5]];
      const cells = layout.map(([r, c, f]) => {
        const inst = die.faces[f].skill; const s = inst ? TND_SKILLS_BY_ID[inst.id] : null;
        const ok = g.selectedSkill && g.canEquip(g.selectedSkill, g.selectedDie, f);
        return `<button class="net-face ${g.selectedFace === f ? 'selected' : ''} ${opp === f ? 'opp-mark' : ''} ${ok ? 'equippable' : ''} ${g.selectedSkill && !ok ? 'dim' : ''}" data-face="${f}" ${s ? `data-tipskill="${s.id}"` : ''} style="grid-row:${r + 1};grid-column:${c + 1}">
          <div class="net-slot">F${f + 1}</div><div class="die-face">${die.faces[f].pip}</div>
          <div class="die-skill">${s ? `<span class="lay-${s.layer}">${s.name}</span> ${s.desc}` : '&nbsp;'}</div>${opp === f ? '<div class="opp-label">맞은편</div>' : ''}</button>`;
      }).join('');
      const ctl = g.selectedFace === null ? '<div class="net-hint">면을 선택하세요. 스킬 목록에서 스킬을 고르면 장착 가능한 면이 강조됩니다.</div>' : `
        <div id="face-ctl"><span>F${g.selectedFace + 1} 눈 변경:</span>
          <button id="btn-minus" class="btn btn-blue" ${die.faces[g.selectedFace].pip <= 1 ? 'disabled' : ''}>−1</button>
          <button id="btn-plus" class="btn btn-blue" ${die.faces[g.selectedFace].pip >= 6 ? 'disabled' : ''}>+1</button></div>`;
      net.innerHTML = `<div class="net-grid">${cells}</div>${ctl}`;
      net.querySelectorAll('[data-face]').forEach(b => {
        b.addEventListener('click', () => {
          const f = Number(b.dataset.face);
          if (g.selectedSkill && g.canEquip(g.selectedSkill, g.selectedDie, f)) g.equip(g.selectedSkill, g.selectedDie, f);
          else g.selectFace(f);
        });
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); g.unequip(g.selectedDie, Number(b.dataset.face)); });
      });
      net.querySelector('#btn-plus')?.addEventListener('click', () => g.changePip(g.selectedDie, g.selectedFace, 1));
      net.querySelector('#btn-minus')?.addEventListener('click', () => g.changePip(g.selectedDie, g.selectedFace, -1));
    }

    // 스킬 목록 (계층 필터, 장착됨 표시)
    const equipped = g.equippedSkillIds();
    const list = this.root.querySelector('#skill-list');
    const faceSel = g.selectedDie !== null && g.selectedFace !== null;
    list.innerHTML = `<div class="panel-title">스킬 목록 (${TND_SKILLS.length}) <span class="panel-sub">장착 ${equipped.size}</span></div>
      <div id="layer-filter">${LAYERS.map(l => `<button class="chip-btn ${this.layerFilter === l ? 'on' : ''}" data-layer="${l}">${l === 'all' ? '전체' : TND_LAYER_LABEL[l]}</button>`).join('')}</div>
      <div id="skill-items">${TND_SKILLS.filter(s => this.layerFilter === 'all' || s.layer === this.layerFilter).map(s => {
        const isEq = equipped.has(s.id);
        const can = faceSel ? g.canEquip(s.id, g.selectedDie, g.selectedFace) : true;
        return `<button class="inv-skill ${isEq ? 'equipped' : ''} ${!isEq && !can ? 'disabled' : ''} ${g.selectedSkill === s.id ? 'picked' : ''}" data-skill="${s.id}" data-tipskill="${s.id}">
          <b>${s.name}</b> ${chips(s)} ${isEq ? '<span class="eq-mark">장착됨</span>' : ''}<div class="desc ${opClass(s)}">${s.desc}</div></button>`;
      }).join('')}</div>`;
    list.querySelectorAll('[data-layer]').forEach(b => b.addEventListener('click', () => { this.layerFilter = b.dataset.layer; this.render(); }));
    list.querySelectorAll('[data-skill]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.skill;
      if (equipped.has(id)) return;
      if (faceSel && g.canEquip(id, g.selectedDie, g.selectedFace)) g.equip(id, g.selectedDie, g.selectedFace);
      else g.selectSkill(id);
    }));

    // 기물덱
    const deck = this.root.querySelector('#deck-panel');
    deck.innerHTML = `<div class="panel-title">기물덱 (${g.deck.length}/${TND.DECK_SIZE}) <span class="panel-sub">우클릭으로 제거</span></div>
      <div id="deck-slots">${Array.from({ length: TND.DECK_SIZE }, (_, i) => g.deck[i]
        ? `<button class="deck-slot filled" data-slot="${i}" data-tippiece="${g.deck[i]}">${PIECES_BY_ID[g.deck[i]].name}<small>${PIECES_BY_ID[g.deck[i]].cost}</small></button>`
        : `<div class="deck-slot"></div>`).join('')}</div>
      <div class="panel-title small">기물 목록 (${PIECES.length})</div>
      <div id="piece-items">${PIECES.map(p => `<button class="piece-item ${g.deck.length >= TND.DECK_SIZE ? 'disabled' : ''}" data-piece="${p.id}" data-tippiece="${p.id}"><b>${p.name}</b> <span class="cond">${p.cost}</span> <span class="role">${p.role}</span></button>`).join('')}</div>`;
    deck.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('contextmenu', (e) => { e.preventDefault(); g.deckRemove(Number(b.dataset.slot)); }));
    deck.querySelectorAll('[data-piece]').forEach(b => b.addEventListener('click', () => g.deckAdd(b.dataset.piece)));
    const start = this.root.querySelector('#btn-start');
    start.disabled = !g.canStart();
    start.textContent = g.canStart() ? '고행 시작' : `고행 시작 (기물덱 ${TND.DECK_SIZE}장 필요)`;
  }

  // ───────── 고행 ─────────
  _renderTrial() {
    const g = this.game;
    const gauge = Array.from({ length: TND.GAUGE }, (_, i) => `<span class="gcell ${i < g.player.gauge ? 'on' : ''}"></span>`).join('');
    this.root.querySelector('#topbar').innerHTML = `
      <span>턴 <b>${g.turn}</b></span><span>신앙 <b class="op-add">${g.player.faith}</b></span><span>적 신앙 <b class="op-mul">${g.enemy.faith}</b></span>
      <span>바퀴 P${g.player.laps} · E${g.enemy.laps}</span><span>내 기물 ${g.myPieceCount()} · 적 기물 ${g.enemyPieceCount()} · 타락 ${g.corruptCount()}</span>
      <span class="gauge">${gauge} <small>${g.player.gauge}/${TND.GAUGE}</small></span>`;
    this._renderBoard();
    this._renderDicePanel();
    this._renderDialog();
    const end = this.root.querySelector('#end-overlay');
    end.classList.toggle('open', g.phase === 'end');
    if (g.phase === 'end') {
      this.root.querySelector('#end-title').textContent = g.result === 'victory' ? '승리!' : '패배';
      this.root.querySelector('#end-desc').textContent = g.result === 'victory' ? `턴 ${g.turn}에 적이 신앙을 지불하지 못했습니다.` : `턴 ${g.turn} · 강제지불 불가.`;
    }
  }
  _renderBoard() {
    const g = this.game;
    const reach = new Map();
    for (const r of g.reachable()) reach.set(r.cell, [...(reach.get(r.cell) || []), r.die + 1]);
    this.root.querySelector('#board').innerHTML = g.board.map(c => {
      const [x, y] = cellXY(c.id);
      const cls = ['cell', c.piece ? `owner-${c.piece.owner}` : '', c.corrupt ? 'corrupt' : '', reach.has(c.id) ? 'reach' : '', c.id === 0 ? 'start' : ''].join(' ');
      const label = c.piece ? (c.piece.owner === 'P' ? `${PIECES_BY_ID[c.piece.defId].name}<b>G${c.piece.grade}</b>` : `사악<b>G${c.piece.grade}</b>`) : (c.id === 0 ? '시작' : '');
      return `<div class="${cls}" style="left:${x}px;top:${y}px" data-tipcell="${c.id}">
        <span class="cid">${c.id}</span><span class="clabel">${label}</span>
        ${c.corrupt ? `<span class="ccount">타락 ${c.corrupt.counter}</span>` : ''}
        ${reach.has(c.id) ? `<span class="reach-mark">${reach.get(c.id).map(n => TND_ORDER_MARK[n - 1]).join('')}</span>` : ''}
        ${g.player.pos === c.id ? '<span class="pawn p">●</span>' : ''}${g.enemy.pos === c.id ? '<span class="pawn e">■</span>' : ''}</div>`;
    }).join('');
  }
  _renderDicePanel() {
    const g = this.game;
    const panel = this.root.querySelector('#dice-panel');
    const rolling = g.sub === 'roll', acting = g.sub === 'act';
    const dice = g.dice.map((d, i) => {
      const inst = d.faces[d.upIndex].skill; const s = inst ? TND_SKILLS_BY_ID[inst.id] : null;
      return `<div class="die small ${d.locked ? 'locked' : ''} ${acting ? 'moveable' : ''} ${g.usedMove === i ? 'used' : ''}" data-die="${i}">
        <div class="die-order">${TND_ORDER_MARK[i]}</div><div class="die-face">${g.activePip(d)}</div>
        <div class="die-skill">${s ? `<span class="lay-${s.layer}">${s.name}</span>` : '&nbsp;'}</div>${d.locked ? '<div class="lock-badge">잠금</div>' : ''}</div>`;
    }).join('');
    let status = '';
    if (rolling) { const p = g.preview(); status = `<div class="preview">신앙치 <b>${p.points}</b> → 신앙 <b class="op-add">+${p.faith}</b> <small>(잔량 ${p.gauge})</small></div>`; }
    else if (acting) status = '<div class="preview">이동할 주사위를 클릭하세요 — 보드에 도착 칸이 표시됩니다</div>';
    else if (g.sub === 'enemy') status = '<div class="preview">적 턴 진행 중</div>';
    else status = '<div class="preview">상호작용 창에 응답하세요</div>';
    panel.innerHTML = `<div id="trial-dice">${dice}</div>${status}
      <div id="actions"><button id="btn-roll" class="btn btn-red" ${!rolling || g.rollsLeft <= 0 ? 'disabled' : ''}>굴림 ${rolling ? g.rollsLeft : ''}</button>
      <button id="btn-confirm" class="btn btn-blue" ${!rolling ? 'disabled' : ''}>확정</button></div>`;
    panel.querySelector('#btn-roll').addEventListener('click', () => g.reroll());
    panel.querySelector('#btn-confirm').addEventListener('click', () => g.confirm());
    panel.querySelectorAll('[data-die]').forEach(el => el.addEventListener('click', () => {
      const i = Number(el.dataset.die);
      if (rolling) g.toggleLock(i); else if (acting) g.chooseMoveDie(i);
    }));
  }
  _renderDialog() {
    const g = this.game; const ov = this.root.querySelector('#dialog-overlay'); const card = this.root.querySelector('#dialog-card');
    const p = g.pending;
    ov.classList.toggle('open', !!p && g.phase === 'trial');
    if (!p) { this.upgradeTarget = null; return; }
    let html = '';
    if (p.type === 'pay') {
      const mine = g.myPieces();
      html = `<div class="panel-title">강제지불 — 사악한 기물 G${g.board[p.pos].piece.grade}</div>
        <div class="dlg-line">비용 <b class="op-mul">${p.cost}</b> · 보유 신앙 <b>${g.player.faith}</b></div>
        <div class="dlg-actions"><button id="dlg-pay" class="btn btn-red" ${g.canPay() ? '' : 'disabled'}>지불</button>${g.mustGiveUp() ? '<button id="dlg-giveup" class="btn btn-blue">게임 포기</button>' : ''}</div>
        ${mine.length ? `<div class="dlg-sub">기물 판매 (판매가 = 비용×G÷2)</div><div class="dlg-list">${mine.map(c => `<button class="dlg-item" data-sell="${c.id}">칸 ${c.id} ${PIECES_BY_ID[c.piece.defId].name} G${c.piece.grade} → +${sellPrice(PIECES_BY_ID[c.piece.defId], c.piece.grade)}</button>`).join('')}</div>` : ''}`;
    } else if (p.type === 'purify') {
      html = `<div class="panel-title">정화 — 칸 ${p.pos} (타락 카운터 ${g.board[p.pos].corrupt.counter})</div>
        <div class="dlg-line">비용 <b>${p.cost}</b> · 보유 신앙 <b>${g.player.faith}</b></div>
        <div class="dlg-actions"><button id="dlg-purify" class="btn btn-red" ${g.player.faith >= p.cost ? '' : 'disabled'}>정화</button><button id="dlg-skip" class="btn btn-blue">건너뛰기</button></div>`;
    } else if (p.type === 'upgrade') {
      if (this.upgradeTarget === null || this.upgradeTarget <= p.grade) this.upgradeTarget = Math.min(TND.MAX_GRADE, p.grade + 1);
      const total = (this.upgradeTarget - p.grade) * p.perLevel;
      html = `<div class="panel-title">업그레이드 — ${p.name} G${p.grade}</div>
        <div class="dlg-line">등급당 ${p.perLevel} · 보유 신앙 <b>${g.player.faith}</b></div>
        <div class="dlg-grades">${Array.from({ length: TND.MAX_GRADE - p.grade }, (_, k) => p.grade + 1 + k).map(t => `<button class="grade-btn ${this.upgradeTarget === t ? 'on' : ''}" data-grade="${t}">G${t}</button>`).join('')}</div>
        <div class="dlg-line">G${p.grade} → G${this.upgradeTarget} 총액 <b class="op-mul">${total}</b></div>
        <div class="dlg-actions"><button id="dlg-upgrade" class="btn btn-red" ${g.player.faith >= total ? '' : 'disabled'}>업그레이드</button><button id="dlg-skip" class="btn btn-blue">건너뛰기</button></div>`;
    } else if (p.type === 'destroy') {
      html = `<div class="panel-title">파괴 — 사악한 기물 G${p.grade} (칸 ${p.pos})</div>
        <div class="dlg-line">파괴 비용 <b class="op-mul">${p.cost}</b> (최종 비용 ×1.5) · 보유 신앙 <b>${g.player.faith}</b> · 파괴 후 건설 가능</div>
        <div class="dlg-actions"><button id="dlg-destroy" class="btn btn-red" ${g.player.faith >= p.cost ? '' : 'disabled'}>파괴</button><button id="dlg-skip" class="btn btn-blue">건너뛰기</button></div>`;
    } else if (p.type === 'build') {
      html = `<div class="panel-title">건설 — 칸 ${p.pos}</div><div class="dlg-line">보유 신앙 <b>${g.player.faith}</b></div>
        <div class="dlg-list">${g.deck.map((id, i) => `<button class="dlg-item ${g.player.faith < PIECES_BY_ID[id].cost ? 'disabled' : ''}" data-build="${id}" data-tippiece="${id}">${PIECES_BY_ID[id].name} · ${PIECES_BY_ID[id].cost}</button>`).join('')}</div>
        <div class="dlg-actions"><button id="dlg-skip" class="btn btn-blue">건너뛰기 (턴 종료)</button></div>`;
    } else if (p.type === 'offering') {
      html = `<div class="panel-title">헌금함 G${p.grade} — 적이 밟았습니다</div>
        <div class="dlg-line">최대 <b>${p.max}</b> 신앙을 헌납하면 적 신앙을 그 2배 차감합니다 (보유 ${g.player.faith})</div>
        <div class="dlg-grades">${Array.from({ length: p.max + 1 }, (_, k) => k).map(k => `<button class="grade-btn" data-offer="${k}">${k}</button>`).join('')}</div>`;
    }
    card.innerHTML = html;
    card.querySelector('#dlg-pay')?.addEventListener('click', () => g.payConfirm());
    card.querySelector('#dlg-giveup')?.addEventListener('click', () => g.giveUp());
    card.querySelectorAll('[data-sell]').forEach(b => b.addEventListener('click', () => g.sellPiece(Number(b.dataset.sell))));
    card.querySelector('#dlg-purify')?.addEventListener('click', () => g.purify());
    card.querySelector('#dlg-upgrade')?.addEventListener('click', () => g.upgradeTo(this.upgradeTarget));
    card.querySelector('#dlg-destroy')?.addEventListener('click', () => g.destroy());
    card.querySelectorAll('[data-grade]').forEach(b => b.addEventListener('click', () => { this.upgradeTarget = Number(b.dataset.grade); this._renderDialog(); }));
    card.querySelectorAll('[data-build]').forEach(b => b.addEventListener('click', () => { if (!b.classList.contains('disabled')) g.build(b.dataset.build); }));
    card.querySelectorAll('[data-offer]').forEach(b => b.addEventListener('click', () => g.offeringPay(Number(b.dataset.offer))));
    card.querySelector('#dlg-skip')?.addEventListener('click', () => {
      if (p.type === 'purify') g.skipPurify(); else if (p.type === 'upgrade') g.skipUpgrade(); else if (p.type === 'destroy') g.skipDestroy(); else if (p.type === 'build') g.skipBuild();
    });
  }
  _renderDeckInfo() {
    const g = this.game;
    this.root.querySelector('#deckinfo-body').innerHTML = `
      <div class="deckinfo-dice">${g.dice.map((d, i) => `<div class="card mini-net"><b>${TND_ORDER_MARK[i]} 주사위 ${i + 1}</b>${d.faces.map((f, k) => {
        const s = f.skill ? TND_SKILLS_BY_ID[f.skill.id] : null; const st = faceState(k, d.upIndex);
        return `<div class="mini-face ${st === 'active' ? 'act' : ''}">F${k + 1} · ${f.pip} · ${s ? `<span class="lay-${s.layer}">${s.name}</span> ${s.desc}` : '—'}</div>`;
      }).join('')}</div>`).join('')}</div>
      <div class="panel-title small">기물덱</div><div class="dlg-list">${g.deck.map(id => `<span class="dlg-item static" data-tippiece="${id}">${PIECES_BY_ID[id].name} · ${PIECES_BY_ID[id].cost}</span>`).join('')}</div>`;
  }

  // ───────── 순차 로그 ─────────
  _queueLog() {
    const g = this.game;
    if (g.log.length < this.lastLogLength) { this.logQueue = []; this.lastLogLength = 0; this.root.querySelector('#log-body').innerHTML = ''; }
    for (let i = this.lastLogLength; i < g.log.length; i++) this.logQueue.push(g.log[i]);
    this.lastLogLength = g.log.length;
  }
  _tickLog() {
    if (!this.logQueue.length) return;
    const e = this.logQueue.shift(); const body = this.root.querySelector('#log-body');
    const div = document.createElement('div'); div.className = `log-line log-${e.type}`; div.textContent = e.text;
    body.appendChild(div); body.scrollTop = body.scrollHeight;
  }
}
