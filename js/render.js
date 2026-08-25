// DOM 렌더링 — 게임 로직을 읽기만 하고, 입력을 game 메서드 호출로 전달한다.
import {
  STAGE_TARGETS, TURNS_PER_STAGE, SKILLS, SKILLS_BY_ID, SKILL_DETAILS,
  condAllows, condLabel,
} from './config.js';

export class Renderer {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.lastLogLength = 0;
    game.onChange = () => this.render();
    this._buildSkeleton();
    this.render();
  }

  _buildSkeleton() {
    this.root.innerHTML = `
      <div id="stage-screen" class="screen">
        <aside id="sidebar" class="card"></aside>
        <main id="board">
          <div id="dice-row"></div>
          <div id="actions">
            <button id="btn-roll" class="btn btn-red">굴림</button>
            <button id="btn-end" class="btn btn-blue">턴 종료</button>
          </div>
        </main>
      </div>
      <div id="maintain-screen" class="screen">
        <div id="maintain-left">
          <div class="card panel-title">정비 — 주사위 관리</div>
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
    this.root.querySelector('#btn-restart').addEventListener('click', () => { this.game.reset(); this.render(); });
    this.root.querySelector('#dice-row').addEventListener('click', (e) => {
      const el = e.target.closest('[data-die]');
      if (el) this.game.toggleLock(Number(el.dataset.die));
    });

    // 도감 열기/닫기 (열기 버튼은 재렌더 영역 안에 있으므로 위임)
    const overlay = this.root.querySelector('#codex-overlay');
    this.root.addEventListener('click', (e) => {
      if (e.target.closest('.btn-codex')) overlay.classList.add('open');
    });
    this.root.querySelector('#btn-codex-close').addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

    // 스킬 툴팁: data-tipskill="스킬id" 요소 위에 마우스를 올리면 상세 설명 표시
    const tip = this.root.querySelector('#tooltip');
    this.root.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tipskill]');
      if (!el) return;
      const s = SKILLS_BY_ID[el.dataset.tipskill];
      if (!s) return;
      tip.innerHTML = `<b>${s.name}</b> <span class="cond">[${condLabel(s.cond)}]</span><div>${SKILL_DETAILS[s.id]}</div>`;
      tip.classList.add('show');
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2;
      x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
      let y = r.top - th - 10;
      if (y < 8) y = r.bottom + 10;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    });
    this.root.addEventListener('mouseout', (e) => {
      if (e.target.closest('[data-tipskill]')) tip.classList.remove('show');
    });
  }

  _codexHTML() {
    const row = (s) => `
      <div class="codex-row">
        <div class="codex-line">
          <b>${s.name}</b>
          <span class="cond">[${condLabel(s.cond)}]</span>
          <span class="codex-effect">${s.desc}</span>
        </div>
        <div class="codex-detail">${SKILL_DETAILS[s.id]}</div>
      </div>`;
    const single = SKILLS.filter(s => !s.effect.type.startsWith('total'));
    const total = SKILLS.filter(s => s.effect.type.startsWith('total'));
    return `
      <div class="codex-section">개별 스킬 — 그 면이 나온 주사위의 점수를 바꾼다 (${single.length}종)</div>
      ${single.map(row).join('')}
      <div class="codex-section">총점 스킬 — 개별 계산이 끝난 턴 합계에 적용된다. 주사위 번호순으로 차례로 발동하며 곱은 중첩된다 (${total.length}종)</div>
      ${total.map(row).join('')}`;
  }

  render() {
    const g = this.game;
    const show = (id, on) => { this.root.querySelector(id).style.display = on ? '' : 'none'; };
    show('#stage-screen', g.phase === 'stage');
    show('#maintain-screen', g.phase === 'maintain');
    show('#end-screen', g.phase === 'gameover' || g.phase === 'victory');
    // 로그 패널은 스테이지/정비 화면이 공유한다 — 현재 화면의 슬롯으로 옮겨 붙인다
    const logPanel = this.root.querySelector('#log-panel');
    if (g.phase === 'stage') {
      const host = this.root.querySelector('#stage-screen');
      if (logPanel.parentElement !== host) host.appendChild(logPanel);
      logPanel.style.display = '';
      this._renderStage();
    } else if (g.phase === 'maintain') {
      const host = this.root.querySelector('#maintain-left');
      if (logPanel.parentElement !== host) host.appendChild(logPanel);
      logPanel.style.display = '';
      this._renderMaintain();
    } else {
      logPanel.style.display = 'none';
      this._renderEnd();
    }
    if (g.phase === 'stage' || g.phase === 'maintain') this._renderLog();
  }

  _renderStage() {
    const g = this.game;
    this.root.querySelector('#sidebar').innerHTML = `
      <div class="side-title">스테이지 ${g.stageNumber}<span class="side-total">/ ${STAGE_TARGETS.length}</span></div>
      <div class="side-item"><span>목표 점수</span><b>${g.target}</b></div>
      <div class="side-item"><span>현재 점수</span><b class="score">${g.score}</b></div>
      <div class="side-item"><span>남은 턴</span><b>${g.turnsLeft} / ${TURNS_PER_STAGE}</b></div>
      <div class="side-item"><span>굴림 기회</span><b>${g.rollsLeft}</b></div>
      <div class="side-hint">주사위 클릭: 잠금/해제<br>스킬 배지에 마우스: 상세 설명</div>
      <button class="btn btn-blue btn-codex">📖 스킬 도감</button>
    `;
    const row = this.root.querySelector('#dice-row');
    row.innerHTML = g.dice.map((d, i) => {
      const skill = g.faceSkill(d);
      return `
        <div class="die ${d.locked ? 'locked' : ''}" data-die="${i}" ${skill ? `data-tipskill="${skill.id}"` : ''}>
          <div class="die-no">주사위 ${i + 1}</div>
          <div class="die-face">${g.faceValue(d)}</div>
          <div class="die-skill">${skill ? skill.name : '&nbsp;'}</div>
          ${d.locked ? '<div class="lock-badge">잠김</div>' : ''}
        </div>`;
    }).join('');
    this.root.querySelector('#btn-roll').disabled = g.rollsLeft <= 0;
  }

  _renderLog() {
    const body = this.root.querySelector('#log-body');
    const g = this.game;
    if (g.log.length < this.lastLogLength) { body.innerHTML = ''; this.lastLogLength = 0; }
    for (let i = this.lastLogLength; i < g.log.length; i++) {
      const e = g.log[i];
      const div = document.createElement('div');
      div.className = `log-line log-${e.type}`;
      div.textContent = e.text;
      body.appendChild(div);
    }
    this.lastLogLength = g.log.length;
    body.scrollTop = body.scrollHeight;
  }

  _renderMaintain() {
    const g = this.game;
    const sel = this.root.querySelector('#dice-select');
    sel.innerHTML = g.dice.map((d, i) => `
      <button class="die mini ${g.selectedDie === i ? 'selected' : ''}" data-sel-die="${i}">
        <div class="die-no">주사위 ${i + 1}</div>
        <div class="die-face">${d.faces.join(' ')}</div>
        <div class="die-skill">${d.skills.filter(Boolean).length}개 스킬</div>
      </button>
    `).join('');
    sel.querySelectorAll('[data-sel-die]').forEach(b =>
      b.addEventListener('click', () => g.selectDie(Number(b.dataset.selDie))));

    const net = this.root.querySelector('#net-area');
    if (g.selectedDie === null) {
      net.innerHTML = '<div class="net-hint">주사위를 선택하면 전개도가 펼쳐집니다.</div>';
    } else {
      const die = g.dice[g.selectedDie];
      // 십자형 전개도: 그리드 위치(행,열)에 면 인덱스 배치 (위 2 / 가운데 4-1-3-5 / 아래 6)
      const layout = [[0, 1, 1], [1, 0, 3], [1, 1, 0], [1, 2, 2], [1, 3, 4], [2, 1, 5]];
      const cells = layout.map(([r, c, f]) => {
        const skillId = die.skills[f];
        const s = skillId ? SKILLS_BY_ID[skillId] : null;
        return `
          <button class="net-face ${g.selectedFace === f ? 'selected' : ''}" data-face="${f}"
                  ${s ? `data-tipskill="${s.id}"` : ''}
                  style="grid-row:${r + 1};grid-column:${c + 1}">
            <div class="die-face">${die.faces[f]}</div>
            <div class="die-skill">${s ? s.name : '&nbsp;'}</div>
          </button>`;
      }).join('');
      const faceCtl = g.selectedFace === null ? '<div class="net-hint">면을 선택하세요.</div>' : `
        <div id="face-ctl">
          <span>면 숫자 변경 (변경권 ${g.inventory.tickets}장):</span>
          <button id="btn-minus" class="btn btn-blue" ${g.inventory.tickets <= 0 || die.faces[g.selectedFace] <= 1 ? 'disabled' : ''}>−1</button>
          <button id="btn-plus" class="btn btn-blue" ${g.inventory.tickets <= 0 || die.faces[g.selectedFace] >= 9 ? 'disabled' : ''}>+1</button>
        </div>`;
      net.innerHTML = `<div class="net-grid">${cells}</div>${faceCtl}`;
      net.querySelectorAll('[data-face]').forEach(b =>
        b.addEventListener('click', () => g.selectFace(Number(b.dataset.face))));
      if (g.selectedFace !== null) {
        net.querySelector('#btn-plus')?.addEventListener('click', () => g.changeFace(g.selectedDie, g.selectedFace, 1));
        net.querySelector('#btn-minus')?.addEventListener('click', () => g.changeFace(g.selectedDie, g.selectedFace, -1));
      }
    }

    const inv = this.root.querySelector('#inventory');
    const faceSelected = g.selectedDie !== null && g.selectedFace !== null;
    const faceValue = faceSelected ? g.dice[g.selectedDie].faces[g.selectedFace] : null;
    inv.innerHTML = `
      <div class="panel-title">인벤토리</div>
      <div class="inv-tickets">숫자 변경권: <b>${g.inventory.tickets}장</b></div>
      <div class="inv-hint">${faceSelected ? `선택한 면: 주사위 ${g.selectedDie + 1}의 ${faceValue}` : '전개도에서 면을 선택하면 스킬을 장착할 수 있습니다.'}</div>
      <div id="inv-skills">
        ${g.inventory.skills.length === 0 ? '<div class="net-hint">보유 스킬 없음</div>' : ''}
        ${g.inventory.skills.map((id, k) => {
          const s = SKILLS_BY_ID[id];
          const ok = faceSelected && condAllows(s.cond, faceValue);
          return `
            <button class="inv-skill ${ok ? '' : 'disabled'}" data-inv="${k}" data-tipskill="${s.id}">
              <b>${s.name}</b> <span class="cond">[${condLabel(s.cond)}]</span>
              <div class="desc">${s.desc}</div>
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
}
