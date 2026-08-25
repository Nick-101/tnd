// DOM 렌더링 — 게임 로직을 읽기만 하고, 입력을 game 메서드 호출로 전달한다. (기획안 v2)
import {
  STAGE_TARGETS, TURNS_PER_STAGE, OPPOSITE,
  SKILLS, SKILLS_BY_ID, SKILL_DETAILS,
  GRADE_LABEL, LAYER_LABEL, LAYER_RATE,
  condAllows, condLabel,
} from './config.js';
import { faceState } from './game.js';

const ORDER_MARK = ['①', '②', '③', '④', '⑤'];
const LOG_LINE_MS = 95; // 로그 한 줄 순차 출력 간격
// 도감 섹션: SKILLS 배열 순서 기준 (기획안 3.1 ~ 3.9)
const CODEX_SECTIONS = [
  [8, '활성형 · 덧셈'], [5, '활성형 · 곱셈'], [6, '맞은편형 (바닥면)'], [4, '측면형 (옆 4면)'],
  [8, '잠재형 (윗면이 아닐 때)'], [4, '집합 참조'], [4, '자원 참조'], [5, '순서 · 누산기 참조'], [4, '성장형'],
];

function skillChips(s) {
  return `<span class="chip chip-${s.layer}">${LAYER_LABEL[s.layer]}</span>`
    + `<span class="chip chip-${s.grade}">${GRADE_LABEL[s.grade]}</span>`
    + `<span class="cond">[${condLabel(s.cond)}]</span>`;
}
// 성장형 인스턴스의 현재 값 표기
function instDesc(inst) {
  const s = SKILLS_BY_ID[inst.id];
  if (s.kind === 'growAdd' || s.kind === 'growStage') return `${s.desc} (현재 +${s.v + inst.growth})`;
  if (s.kind === 'growMult') return `${s.desc} (현재 ×${(s.v + inst.growth).toFixed(1)})`;
  return s.desc;
}

export class Renderer {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.lastLogLength = 0;
    this.logQueue = [];
    game.onChange = () => this.render();
    this._buildSkeleton();
    this.logTicker = setInterval(() => this._tickLog(), LOG_LINE_MS);
    this.render();
  }

  _buildSkeleton() {
    this.root.innerHTML = `
      <div id="stage-screen" class="screen">
        <aside id="sidebar" class="card"></aside>
        <main id="board">
          <div id="dice-row"></div>
          <div id="preview-panel" class="card">예상 점수 <b id="preview-value">0</b></div>
          <div id="actions">
            <button id="btn-roll" class="btn btn-red">굴림</button>
            <button id="btn-end" class="btn btn-blue">턴 종료</button>
          </div>
        </main>
      </div>
      <div id="draft-screen" class="screen">
        <div class="card" id="draft-card">
          <div class="panel-title" id="draft-title"></div>
          <div id="draft-cards"></div>
          <button id="btn-draft-confirm" class="btn btn-red big">선택 확정</button>
        </div>
      </div>
      <div id="maintain-screen" class="screen">
        <div id="maintain-left">
          <div class="card panel-title">정비 — 주사위 관리 <span class="panel-sub">◀ ▶ 로 계산 순서 변경 · 스킬 면 우클릭으로 회수</span></div>
          <div id="dice-select"></div>
          <div id="net-area" class="card"></div>
        </div>
        <div id="maintain-right">
          <button class="btn btn-blue btn-codex">📖 스킬 도감</button>
          <div id="inventory" class="card"></div>
          <button id="btn-next" class="btn btn-red big">다음 스테이지 ▶</button>
        </div>
      </div>
      <div id="end-screen" class="screen">
        <div class="card end-card">
          <div id="end-title"></div>
          <div id="end-desc"></div>
          <button id="btn-restart" class="btn btn-red big">처음부터</button>
        </div>
      </div>
      <div id="log-panel" class="card">
        <div class="log-title">로그</div>
        <div id="log-body"></div>
      </div>
      <div id="codex-overlay">
        <div id="codex-card" class="card">
          <div id="codex-head">
            <span class="panel-title">스킬 도감 — 전체 ${SKILLS.length}종</span>
            <button id="btn-codex-close" class="btn btn-red">닫기 ✕</button>
          </div>
          <div id="codex-body">${this._codexHTML()}</div>
        </div>
      </div>
      <div id="tooltip"></div>
    `;
    this.root.querySelector('#btn-roll').addEventListener('click', () => this.game.reroll());
    this.root.querySelector('#btn-end').addEventListener('click', () => this.game.endTurn());
    this.root.querySelector('#btn-next').addEventListener('click', () => this.game.nextStage());
    this.root.querySelector('#btn-draft-confirm').addEventListener('click', () => this.game.draftConfirm());
    this.root.querySelector('#btn-restart').addEventListener('click', () => {
      this.game.reset();
      this.logQueue = [];
      this.lastLogLength = 0;
      this.root.querySelector('#log-body').innerHTML = '';
      this.render();
    });
    this.root.querySelector('#dice-row').addEventListener('click', (e) => {
      const el = e.target.closest('[data-die]');
      if (el) this.game.toggleLock(Number(el.dataset.die));
    });
    this.root.querySelector('#draft-cards').addEventListener('click', (e) => {
      const el = e.target.closest('[data-draft]');
      if (el) this.game.draftToggle(Number(el.dataset.draft));
    });

    // 도감 열기/닫기
    const overlay = this.root.querySelector('#codex-overlay');
    this.root.addEventListener('click', (e) => {
      if (e.target.closest('.btn-codex')) overlay.classList.add('open');
    });
    this.root.querySelector('#btn-codex-close').addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

    // 툴팁: data-tipskill(스킬 상세) / data-tipdie(주사위 6면 구성)
    const tip = this.root.querySelector('#tooltip');
    this.root.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tipskill], [data-tipdie]');
      if (!el) return;
      if (el.dataset.tipskill) {
        const s = SKILLS_BY_ID[el.dataset.tipskill];
        if (!s) return;
        tip.innerHTML = `<b>${s.name}</b> ${skillChips(s)}<div>${SKILL_DETAILS[s.id]}</div>`;
      } else {
        tip.innerHTML = this._dieTipHTML(Number(el.dataset.tipdie));
      }
      tip.classList.add('show');
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
      let y = r.top - th - 10;
      if (y < 8) y = r.bottom + 10;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    });
    this.root.addEventListener('mouseout', (e) => {
      if (e.target.closest('[data-tipskill], [data-tipdie]')) tip.classList.remove('show');
    });
  }

  // 주사위 6면 구성 툴팁 (슬롯 · 눈 · 스킬 · 현재 상태)
  _dieTipHTML(i) {
    const die = this.game.dice[i];
    if (!die) return '';
    const rows = die.faces.map((face, f) => {
      const st = faceState(f, die.upIndex);
      const inst = face.skill;
      const s = inst ? SKILLS_BY_ID[inst.id] : null;
      return `<tr class="tiprow-${st}">
        <td>F${f + 1}</td><td>${face.pip}</td>
        <td>${st === 'active' ? '활성' : st === 'opposite' ? '맞은편' : '측면'}</td>
        <td>${s ? `<span class="lay-${s.layer}">${s.name}</span> ${s.desc}` : '—'}</td>
      </tr>`;
    }).join('');
    return `<b>주사위 ${i + 1} — 6면 구성</b>
      <table class="dietip"><tr><th>면</th><th>눈</th><th>상태</th><th>스킬</th></tr>${rows}</table>`;
  }

  _codexHTML() {
    let idx = 0;
    let html = '';
    for (const [count, title] of CODEX_SECTIONS) {
      html += `<div class="codex-section">${title} (${count}종)</div>`;
      for (const s of SKILLS.slice(idx, idx + count)) {
        html += `
          <div class="codex-row">
            <div class="codex-line">
              <b>${s.name}</b> ${skillChips(s)}
              <span class="codex-effect ${s.op === 'mul' ? 'op-mul' : 'op-add'}">${s.desc}</span>
            </div>
            <div class="codex-detail">${SKILL_DETAILS[s.id]}</div>
          </div>`;
      }
      idx += count;
    }
    return html;
  }

  render() {
    const g = this.game;
    const show = (id, on) => { this.root.querySelector(id).style.display = on ? '' : 'none'; };
    show('#stage-screen', g.phase === 'stage');
    show('#draft-screen', g.phase === 'draft');
    show('#maintain-screen', g.phase === 'maintain');
    show('#end-screen', g.phase === 'gameover' || g.phase === 'victory');
    // 로그 패널은 스테이지/드래프트/정비 화면이 공유
    const logPanel = this.root.querySelector('#log-panel');
    if (g.phase === 'stage') {
      const host = this.root.querySelector('#stage-screen');
      if (logPanel.parentElement !== host) host.appendChild(logPanel);
      logPanel.style.display = '';
      this._renderStage();
    } else if (g.phase === 'maintain' || g.phase === 'draft') {
      const host = g.phase === 'maintain' ? this.root.querySelector('#maintain-left') : this.root.querySelector('#draft-screen');
      if (logPanel.parentElement !== host) host.appendChild(logPanel);
      logPanel.style.display = '';
      if (g.phase === 'maintain') this._renderMaintain();
      else this._renderDraft();
    } else {
      logPanel.style.display = 'none';
      this._renderEnd();
    }
    this._queueLog();
  }

  _renderStage() {
    const g = this.game;
    const pct = Math.min(100, Math.round((g.score / g.target) * 100));
    this.root.querySelector('#sidebar').innerHTML = `
      <div class="side-title">스테이지 ${g.stageNumber}<span class="side-total">/ ${STAGE_TARGETS.length}</span></div>
      <div class="side-item"><span>목표 점수</span><b>${g.target}</b></div>
      <div class="side-item"><span>현재 점수</span><b class="score">${g.score}</b></div>
      <div class="progress"><div class="progress-fill" style="width:${pct}%"></div><span class="progress-text">${pct}%</span></div>
      <div class="side-item"><span>남은 턴</span><b>${g.turnsLeft} / ${TURNS_PER_STAGE}</b></div>
      <div class="side-item"><span>남은 재굴림</span><b>${g.rollsLeft}</b></div>
      <div class="side-item"><span>보유 스킬</span><b>${g.inventory.skills.length}</b></div>
      <div class="side-item"><span>변경권</span><b>${g.inventory.tickets}</b></div>
      <div class="side-hint">주사위 클릭: 잠금<br>주사위에 마우스: 6면 구성</div>
      <button class="btn btn-blue btn-codex">📖 스킬 도감</button>
    `;
    const row = this.root.querySelector('#dice-row');
    row.innerHTML = g.dice.map((d, i) => {
      const s = g.activeSkill(d);
      return `
        <div class="die ${d.locked ? 'locked' : ''}" data-die="${i}" data-tipdie="${i}">
          <div class="die-order">${ORDER_MARK[i]}</div>
          <div class="die-no">F${d.upIndex + 1}</div>
          <div class="die-face">${g.activePip(d)}</div>
          <div class="die-skill">${s ? `<span class="lay-${s.layer}">${s.name}</span>` : '&nbsp;'}</div>
          ${d.locked ? '<div class="lock-badge">잠금</div>' : ''}
        </div>`;
    }).join('');
    this.root.querySelector('#preview-value').textContent = g.preview();
    const rollBtn = this.root.querySelector('#btn-roll');
    rollBtn.disabled = g.rollsLeft <= 0;
    rollBtn.textContent = `굴림 ${g.rollsLeft}`;
  }

  _renderDraft() {
    const g = this.game;
    if (!g.draft) return;
    const picked = g.draft.picked.filter(Boolean).length;
    this.root.querySelector('#draft-title').textContent =
      `스테이지 ${g.stageNumber} 클리어 — 스킬 ${g.draft.offer.length}개 중 ${g.draft.pick}개 선택 (${picked}/${g.draft.pick})`;
    this.root.querySelector('#draft-cards').innerHTML = g.draft.offer.map((id, i) => {
      const s = SKILLS_BY_ID[id];
      return `
        <button class="draft-card grade-${s.grade} ${g.draft.picked[i] ? 'picked' : ''}" data-draft="${i}" data-tipskill="${id}">
          <div class="draft-name">${s.name}</div>
          <div class="draft-chips">${skillChips(s)}</div>
          <div class="draft-effect ${s.op === 'mul' ? 'op-mul' : 'op-add'}">${s.desc}</div>
          <div class="draft-rate">예상 발동률 ${LAYER_RATE[s.layer]}</div>
        </button>`;
    }).join('');
    this.root.querySelector('#btn-draft-confirm').disabled = picked !== g.draft.pick;
  }

  _renderMaintain() {
    const g = this.game;
    const sel = this.root.querySelector('#dice-select');
    sel.innerHTML = g.dice.map((d, i) => {
      let add = 0, mul = 0, empty = 0;
      for (const f of d.faces) {
        if (!f.skill) empty += 1;
        else if (SKILLS_BY_ID[f.skill.id].op === 'mul') mul += 1;
        else add += 1;
      }
      return `
        <div class="die-card-wrap">
          <div class="order-ctl">
            <button class="order-btn" data-move-left="${i}" ${i === 0 ? 'disabled' : ''}>◀</button>
            <span class="die-order">${ORDER_MARK[i]}</span>
            <button class="order-btn" data-move-right="${i}" ${i === g.dice.length - 1 ? 'disabled' : ''}>▶</button>
          </div>
          <button class="die mini ${g.selectedDie === i ? 'selected' : ''}" data-sel-die="${i}">
            <div class="die-no">주사위 ${i + 1}</div>
            <div class="die-face">${d.faces.map(f => f.pip).join(' ')}</div>
            <div class="die-badge"><span class="op-add">덧셈 ${add}</span> · <span class="op-mul">곱셈 ${mul}</span> · 빈면 ${empty}</div>
          </button>
        </div>`;
    }).join('');
    sel.querySelectorAll('[data-sel-die]').forEach(b =>
      b.addEventListener('click', () => g.selectDie(Number(b.dataset.selDie))));
    sel.querySelectorAll('[data-move-left]').forEach(b =>
      b.addEventListener('click', () => g.moveDie(Number(b.dataset.moveLeft), -1)));
    sel.querySelectorAll('[data-move-right]').forEach(b =>
      b.addEventListener('click', () => g.moveDie(Number(b.dataset.moveRight), 1)));

    const net = this.root.querySelector('#net-area');
    if (g.selectedDie === null) {
      net.innerHTML = '<div class="net-hint">주사위를 선택하면 전개도가 펼쳐집니다.</div>';
    } else {
      const die = g.dice[g.selectedDie];
      const oppOfSel = g.selectedFace !== null ? OPPOSITE[g.selectedFace] : null;
      // 십자형 전개도: 위 F2 / 가운데 F4-F1-F3-F5 / 아래 F6 (슬롯 인덱스 1 / 3,0,2,4 / 5)
      const layout = [[0, 1, 1], [1, 0, 3], [1, 1, 0], [1, 2, 2], [1, 3, 4], [2, 1, 5]];
      const cells = layout.map(([r, c, f]) => {
        const inst = die.faces[f].skill;
        const s = inst ? SKILLS_BY_ID[inst.id] : null;
        const cls = [
          g.selectedFace === f ? 'selected' : '',
          oppOfSel === f ? 'opp-mark' : '',
        ].join(' ');
        return `
          <button class="net-face ${cls}" data-face="${f}" ${s ? `data-tipskill="${s.id}"` : ''}
                  style="grid-row:${r + 1};grid-column:${c + 1}">
            <div class="net-slot">F${f + 1}</div>
            <div class="die-face">${die.faces[f].pip}</div>
            <div class="die-skill">${s ? `<span class="lay-${s.layer}">${s.name}</span> ${s.desc}` : '&nbsp;'}</div>
            ${oppOfSel === f ? '<div class="opp-label">맞은편</div>' : ''}
          </button>`;
      }).join('');
      const faceCtl = g.selectedFace === null ? '<div class="net-hint">면을 선택하세요. 선택한 면의 맞은편이 점선으로 표시됩니다. 스킬이 있는 면은 우클릭으로 회수.</div>' : `
        <div id="face-ctl">
          <span>F${g.selectedFace + 1} 눈 변경 (변경권 ${g.inventory.tickets}장):</span>
          <button id="btn-minus" class="btn btn-blue" ${g.inventory.tickets <= 0 || die.faces[g.selectedFace].pip <= 1 ? 'disabled' : ''}>−1</button>
          <button id="btn-plus" class="btn btn-blue" ${g.inventory.tickets <= 0 || die.faces[g.selectedFace].pip >= 6 ? 'disabled' : ''}>+1</button>
        </div>`;
      net.innerHTML = `<div class="net-grid">${cells}</div>${faceCtl}`;
      net.querySelectorAll('[data-face]').forEach(b => {
        b.addEventListener('click', () => g.selectFace(Number(b.dataset.face)));
        b.addEventListener('contextmenu', (e) => { // 우클릭 회수
          e.preventDefault();
          g.unequipSkill(g.selectedDie, Number(b.dataset.face));
        });
      });
      if (g.selectedFace !== null) {
        net.querySelector('#btn-plus')?.addEventListener('click', () => g.changeFace(g.selectedDie, g.selectedFace, 1));
        net.querySelector('#btn-minus')?.addEventListener('click', () => g.changeFace(g.selectedDie, g.selectedFace, -1));
      }
    }

    const inv = this.root.querySelector('#inventory');
    const faceSelected = g.selectedDie !== null && g.selectedFace !== null;
    const facePip = faceSelected ? g.dice[g.selectedDie].faces[g.selectedFace].pip : null;
    inv.innerHTML = `
      <div class="panel-title">인벤토리</div>
      <div class="inv-tickets">숫자 변경권: <b>${g.inventory.tickets}장</b></div>
      <div class="inv-hint">${faceSelected ? `선택한 면: 주사위 ${g.selectedDie + 1} · F${g.selectedFace + 1} (눈 ${facePip})` : '전개도에서 면을 선택하면 스킬을 장착할 수 있습니다.'}</div>
      <div id="inv-skills">
        ${g.inventory.skills.length === 0 ? '<div class="net-hint">보유 스킬 없음</div>' : ''}
        ${g.inventory.skills.map((inst, k) => {
          const s = SKILLS_BY_ID[inst.id];
          const ok = faceSelected && condAllows(s.cond, facePip);
          return `
            <button class="inv-skill ${ok ? '' : 'disabled'}" data-inv="${k}" data-tipskill="${s.id}">
              <b>${s.name}</b> ${skillChips(s)}
              <div class="desc ${s.op === 'mul' ? 'op-mul' : 'op-add'}">${instDesc(inst)}</div>
            </button>`;
        }).join('')}
      </div>`;
    // disabled 속성은 마우스 이벤트(툴팁)를 막으므로 클래스로 비활성 처리
    inv.querySelectorAll('[data-inv]').forEach(b =>
      b.addEventListener('click', () => {
        if (b.classList.contains('disabled')) return;
        g.equipSkill(Number(b.dataset.inv), g.selectedDie, g.selectedFace);
      }));
  }

  _renderEnd() {
    const g = this.game;
    const win = g.phase === 'victory';
    this.root.querySelector('#end-title').textContent = win ? '승리!' : '패배';
    this.root.querySelector('#end-desc').textContent = win
      ? '8개 스테이지를 모두 클리어했습니다.'
      : `스테이지 ${g.stageNumber}에서 목표 미달 (${g.score}/${g.target})`;
  }

  // ---------- 로그: 한 줄씩 순차 출력 (연출 대체 — 기획안 2.10) ----------
  _queueLog() {
    const g = this.game;
    if (g.log.length < this.lastLogLength) { // reset 등
      this.logQueue = [];
      this.lastLogLength = 0;
      this.root.querySelector('#log-body').innerHTML = '';
    }
    for (let i = this.lastLogLength; i < g.log.length; i++) this.logQueue.push(g.log[i]);
    this.lastLogLength = g.log.length;
  }

  _tickLog() {
    if (this.logQueue.length === 0) return;
    const e = this.logQueue.shift();
    const body = this.root.querySelector('#log-body');
    const div = document.createElement('div');
    div.className = `log-line log-${e.type}`;
    div.textContent = e.text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }
}
