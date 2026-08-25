// 게임 상수 및 데이터 정의 (로직 없음 — game.js가 해석한다) — 기획안 v2
export const START_DICE = 1;      // QA 시 올려서 잠금 테스트 (구현 노트)
export const MAX_DICE = 5;
export const FACE_COUNT = 6;      // 면 슬롯 F1~F6
export const FACE_MIN = 1;
export const FACE_MAX = 6;        // v2: 눈 범위 1~6
export const TURNS_PER_STAGE = 4;
export const ROLLS_PER_TURN = 3;  // 턴 시작 자동 굴림 1회 포함 (재굴림 2회)
export const REWARD_TICKET_COUNT = 2;
export const DICE_REWARD_STAGES = 4; // 스테이지 1~4 클리어 시 주사위 +1

// 맞은편 관계 (슬롯 인덱스 0~5 = F1~F6): F1↔F6, F2↔F5, F3↔F4 — 절대 불변
export const OPPOSITE = [5, 4, 3, 2, 1, 0];

// 스테이지별 목표 점수 — v2 표(30~1650)를 기준으로 하되, 기획안 8절의 규칙
// "목표/4턴 능력치 중앙값 ≈ 0.7 유지"를 본 구현의 실측 능력치로 재적용해 미세 조정
// (봇 완주율 41% ≈ 기획안 약한 모델 37%). 실측 근거는 design/plan.md 참조.
export const STAGE_TARGETS = [30, 65, 110, 160, 240, 330, 460, 620];

// 보상 드래프트: 스테이지 1~4는 4택2, 5~7은 5택3 (표 기준), 8은 게임 클리어
export function draftSpec(stageNumber) {
  if (stageNumber >= 8) return null;
  return stageNumber <= 4 ? { offer: 4, pick: 2 } : { offer: 5, pick: 3 };
}

// 등급 드롭률: 일반 60% / 고급 30% / 희귀 10%
export const GRADE_WEIGHTS = { common: 0.6, advanced: 0.3, rare: 0.1 };
export const GRADE_LABEL = { common: '일반', advanced: '고급', rare: '희귀' };
export const LAYER_LABEL = { active: '활성', opposite: '맞은편', side: '측면', latent: '잠재' };
// 계층 가동률 (드래프트 카드의 예상 발동률 표기용)
export const LAYER_RATE = { active: '17%', opposite: '17%', side: '67%', latent: '83%' };

// 스타터 장비: 슬롯 인덱스 → 스킬 id (2.2절 고정 지급)
export const STARTER_SKILLS = { 5: 'jungta', 0: 'janhyang', 1: 'yeoun' }; // F6 정타 / F1 잔향 / F2 여운

// 장착 조건: any | low(1~3) | high(4~6) | even | odd | exact n | oneOf [a,b]
// layer: 발동 계층. op: add|mul. kind: 효과 계산 방식 (game.js가 해석)
export const SKILLS = [
  // ── 3.1 활성형 · 덧셈 ──
  { id: 'jungta',    name: '정타',       grade: 'common',   layer: 'active',   cond: { kind: 'any' },            op: 'add', kind: 'flat', v: 6,  desc: '+6' },
  { id: 'gangta',    name: '강타',       grade: 'common',   layer: 'active',   cond: { kind: 'high' },           op: 'add', kind: 'flat', v: 9,  desc: '+9' },
  { id: 'janta',     name: '잔타',       grade: 'common',   layer: 'active',   cond: { kind: 'low' },            op: 'add', kind: 'flat', v: 7,  desc: '+7' },
  { id: 'baega',     name: '배가',       grade: 'common',   layer: 'active',   cond: { kind: 'any' },            op: 'add', kind: 'pip',          desc: '이 면의 눈만큼 +' },
  { id: 'holgyeol',  name: '홀의 결의', grade: 'common',   layer: 'active',   cond: { kind: 'odd' },            op: 'add', kind: 'flat', v: 10, desc: '+10' },
  { id: 'jjakgyul',  name: '짝의 규율', grade: 'common',   layer: 'active',   cond: { kind: 'even' },           op: 'add', kind: 'flat', v: 10, desc: '+10' },
  { id: 'yanggeuk',  name: '양극',       grade: 'advanced', layer: 'active',   cond: { kind: 'oneOf', ns: [1, 6] }, op: 'add', kind: 'flat', v: 13, desc: '+13' },
  { id: 'jungyong',  name: '중용',       grade: 'advanced', layer: 'active',   cond: { kind: 'oneOf', ns: [3, 4] }, op: 'add', kind: 'flat', v: 12, desc: '+12' },
  // ── 3.2 활성형 · 곱셈 ──
  { id: 'gongmyeong', name: '공명',      grade: 'advanced', layer: 'active',   cond: { kind: 'even' },           op: 'mul', kind: 'flat', v: 1.8, desc: '×1.8' },
  { id: 'payeol',    name: '파열',       grade: 'advanced', layer: 'active',   cond: { kind: 'high' },           op: 'mul', kind: 'flat', v: 2.0, desc: '×2.0' },
  { id: 'mijin',     name: '미진',       grade: 'advanced', layer: 'active',   cond: { kind: 'exact', n: 1 },    op: 'mul', kind: 'flat', v: 2.0, desc: '×2.0' },
  { id: 'noegwan',   name: '뇌관',       grade: 'rare',     layer: 'active',   cond: { kind: 'exact', n: 5 },    op: 'mul', kind: 'flat', v: 2.2, desc: '×2.2' },
  { id: 'jeungpok',  name: '증폭',       grade: 'rare',     layer: 'active',   cond: { kind: 'exact', n: 6 },    op: 'mul', kind: 'flat', v: 2.5, desc: '×2.5' },
  // ── 3.3 맞은편형 (바닥면) ──
  { id: 'simcheung', name: '심층',       grade: 'common',   layer: 'opposite', cond: { kind: 'low' },            op: 'add', kind: 'flat', v: 12, desc: '+12' },
  { id: 'mugechu',   name: '무게추',     grade: 'common',   layer: 'opposite', cond: { kind: 'even' },           op: 'add', kind: 'flat', v: 13, desc: '+13' },
  { id: 'chimgang',  name: '침강',       grade: 'advanced', layer: 'opposite', cond: { kind: 'high' },           op: 'add', kind: 'flat', v: 15, desc: '+15' },
  { id: 'daeching',  name: '대칭',       grade: 'advanced', layer: 'opposite', cond: { kind: 'any' },            op: 'add', kind: 'oppSum',       desc: '윗면 눈 + 이 면 눈만큼 +' },
  { id: 'banhyang',  name: '반향',       grade: 'rare',     layer: 'opposite', cond: { kind: 'any' },            op: 'mul', kind: 'flat', v: 2.0, desc: '×2.0' },
  { id: 'wanjeon',   name: '완전대칭',   grade: 'rare',     layer: 'opposite', cond: { kind: 'any' },            op: 'mul', kind: 'symMult', v: 3.0, desc: '윗면 눈 = 이 면 눈이면 ×3.0' },
  // ── 3.4 측면형 (옆 4면) ──
  { id: 'gyeotnal',  name: '곁날',       grade: 'common',   layer: 'side',     cond: { kind: 'any' },            op: 'add', kind: 'flat', v: 3,  desc: '+3' },
  { id: 'cheugap',   name: '측압',       grade: 'common',   layer: 'side',     cond: { kind: 'high' },           op: 'add', kind: 'flat', v: 4,  desc: '+4' },
  { id: 'geurimja',  name: '그림자',     grade: 'common',   layer: 'side',     cond: { kind: 'odd' },            op: 'add', kind: 'flat', v: 4,  desc: '+4' },
  { id: 'mugeum',    name: '묵음',       grade: 'rare',     layer: 'side',     cond: { kind: 'any' },            op: 'mul', kind: 'flat', v: 1.3, desc: '×1.3' },
  // ── 3.5 잠재형 (윗면이 아닐 때) ──
  { id: 'janhyang',  name: '잔향',       grade: 'common',   layer: 'latent',   cond: { kind: 'any' },            op: 'add', kind: 'flat', v: 2,  desc: '+2' },
  { id: 'yeoun',     name: '여운',       grade: 'common',   layer: 'latent',   cond: { kind: 'low' },            op: 'add', kind: 'flat', v: 3,  desc: '+3' },
  { id: 'jeoryu',    name: '저류',       grade: 'common',   layer: 'latent',   cond: { kind: 'even' },           op: 'add', kind: 'flat', v: 3,  desc: '+3' },
  { id: 'chukjeok',  name: '축적',       grade: 'common',   layer: 'latent',   cond: { kind: 'any' },            op: 'add', kind: 'halfPip',      desc: '이 면 눈의 절반(내림)만큼 +' },
  { id: 'tongil',    name: '통일',       grade: 'advanced', layer: 'latent',   cond: { kind: 'any' },            op: 'add', kind: 'parityAll', v: 7, desc: '모든 활성 눈의 홀짝이 같으면 +7' },
  { id: 'miyeol',    name: '미열',       grade: 'advanced', layer: 'latent',   cond: { kind: 'any' },            op: 'mul', kind: 'flat', v: 1.25, desc: '×1.25' },
  { id: 'silseon',   name: '실선',       grade: 'advanced', layer: 'latent',   cond: { kind: 'low' },            op: 'mul', kind: 'flat', v: 1.3, desc: '×1.3' },
  { id: 'jeoeum',    name: '저음',       grade: 'advanced', layer: 'latent',   cond: { kind: 'even' },           op: 'mul', kind: 'flat', v: 1.3, desc: '×1.3' },
  // ── 3.6 집합 참조 ──
  { id: 'ssang',     name: '쌍',         grade: 'common',   layer: 'active',   cond: { kind: 'any' },            op: 'add', kind: 'pairActive', v: 12, desc: '활성 눈 중 같은 값 2개 이상이면 +12' },
  { id: 'yeonswae',  name: '연쇄',       grade: 'advanced', layer: 'active',   cond: { kind: 'any' },            op: 'add', kind: 'runActive', v: 18, desc: '활성 눈에 연속 값 3개 이상이면 +18' },
  { id: 'sangae',    name: '산개',       grade: 'advanced', layer: 'active',   cond: { kind: 'any' },            op: 'mul', kind: 'distinctActive', v: 1.8, desc: '모든 활성 눈이 서로 다르면 ×1.8' },
  { id: 'samjung',   name: '삼중',       grade: 'rare',     layer: 'active',   cond: { kind: 'any' },            op: 'mul', kind: 'tripleActive', v: 2.2, desc: '활성 눈 중 같은 값 3개 이상이면 ×2.2' },
  // ── 3.7 자원 참조 ──
  { id: 'gyeolsok',  name: '결속',       grade: 'common',   layer: 'latent',   cond: { kind: 'any' },            op: 'add', kind: 'perLocked', v: 3, desc: '잠긴 주사위 1개당 +3' },
  { id: 'jeolje',    name: '절제',       grade: 'advanced', layer: 'active',   cond: { kind: 'any' },            op: 'add', kind: 'perReroll', v: 7, desc: '남은 재굴림 1회당 +7' },
  { id: 'yeoyu',     name: '여유',       grade: 'advanced', layer: 'opposite', cond: { kind: 'any' },            op: 'add', kind: 'perTurnAfter', v: 6, desc: '남은 턴 1회당 +6' },
  { id: 'jogeup',    name: '조급',       grade: 'rare',     layer: 'active',   cond: { kind: 'any' },            op: 'mul', kind: 'noReroll', v: 1.9, desc: '재굴림을 모두 소진했다면 ×1.9' },
  // ── 3.8 순서 · 누산기 참조 ──
  { id: 'gyedan',    name: '계단',       grade: 'common',   layer: 'latent',   cond: { kind: 'any' },            op: 'add', kind: 'perFront', v: 2, desc: '앞에 놓인 주사위 1개당 +2' },
  { id: 'seonbong',  name: '선봉',       grade: 'advanced', layer: 'active',   cond: { kind: 'any' },            op: 'add', kind: 'first', v: 16, desc: '이 주사위가 첫 번째일 때만 +16' },
  { id: 'dohwaseon', name: '도화선',     grade: 'advanced', layer: 'active',   cond: { kind: 'low' },            op: 'add', kind: 'fuse', v: 20, desc: '직전 누적 점수가 30 미만이면 +20' },
  { id: 'gwanseong', name: '관성',       grade: 'rare',     layer: 'active',   cond: { kind: 'any' },            op: 'mul', kind: 'inertia', v: 1.7, desc: '직전 누적 점수가 60 이상이면 ×1.7' },
  { id: 'huwi',      name: '후위',       grade: 'rare',     layer: 'active',   cond: { kind: 'any' },            op: 'mul', kind: 'last', v: 2.2, desc: '이 주사위가 마지막일 때 ×2.2' },
  // ── 3.9 성장형 ──
  { id: 'banbok',    name: '반복',       grade: 'common',   layer: 'latent',   cond: { kind: 'any' },            op: 'add', kind: 'growCount',    desc: '이번 스테이지에서 발동한 횟수만큼 +' },
  { id: 'seongjang', name: '성장',       grade: 'advanced', layer: 'active',   cond: { kind: 'any' },            op: 'add', kind: 'growAdd', v: 3, step: 2, desc: '+3으로 시작, 발동마다 영구히 +2' },
  { id: 'gagin',     name: '각인',       grade: 'advanced', layer: 'opposite', cond: { kind: 'any' },            op: 'add', kind: 'growStage', v: 5, step: 5, desc: '+5로 시작, 스테이지 클리어마다 영구히 +5' },
  { id: 'yeonma',    name: '연마',       grade: 'rare',     layer: 'active',   cond: { kind: 'exact', n: 6 },    op: 'mul', kind: 'growMult', v: 1.5, step: 0.1, desc: '×1.5로 시작, 발동마다 배수 영구히 +0.1' },
];

export const SKILLS_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));

// 장착 조건 검사: 면의 눈 value에 이 스킬을 둘 수 있는가
export function condAllows(cond, value) {
  switch (cond.kind) {
    case 'any': return true;
    case 'low': return value <= 3;
    case 'high': return value >= 4;
    case 'even': return value % 2 === 0;
    case 'odd': return value % 2 === 1;
    case 'exact': return value === cond.n;
    case 'oneOf': return cond.ns.includes(value);
    default: return false;
  }
}

export function condLabel(cond) {
  switch (cond.kind) {
    case 'any': return '모든 눈';
    case 'low': return '1~3';
    case 'high': return '4~6';
    case 'even': return '짝수';
    case 'odd': return '홀수';
    case 'exact': return `${cond.n}만`;
    case 'oneOf': return cond.ns.join(' 또는 ');
    default: return '?';
  }
}

// 스킬 상세 설명 (도감·툴팁용) — 발동 계층, 계산 방식, 예시까지 풀어서 설명
export const SKILL_DETAILS = {
  jungta: '활성형: 이 면이 윗면일 때만 발동한다. 누산 점수에 +6. 스타터 스킬 — "윗면이 되면 터진다"의 기본형.',
  gangta: '활성형. 눈 4~6인 면에만 장착 가능. 이 면이 윗면이면 누산 점수에 +9.',
  janta: '활성형. 눈 1~3인 면 전용. 이 면이 윗면이면 +7. 낮은 눈을 띄워도 손해가 아니게 만든다.',
  baega: '활성형. 이 면이 윗면이면 이 면의 눈만큼 한 번 더 더한다 (사실상 눈이 두 배로 계산).',
  holgyeol: '활성형. 홀수 눈 면 전용. 이 면이 윗면이면 +10.',
  jjakgyul: '활성형. 짝수 눈 면 전용. 이 면이 윗면이면 +10.',
  yanggeuk: '활성형. 눈이 1 또는 6인 면에만 장착 가능. 이 면이 윗면이면 +13.',
  jungyong: '활성형. 눈이 3 또는 4인 면에만 장착 가능. 이 면이 윗면이면 +12.',
  gongmyeong: '활성형 곱셈. 짝수 눈 면 전용. 이 면이 윗면이면 그 시점까지의 누산 점수를 ×1.8. 곱셈은 뒤 순서 주사위에 둘수록 강하다.',
  payeol: '활성형 곱셈. 눈 4~6 면 전용. 이 면이 윗면이면 누산 점수 ×2.0.',
  mijin: '활성형 곱셈. 눈 1인 면 전용. 1이 윗면이면 누산 점수 ×2.0. 최저 눈을 폭탄으로 바꾼다.',
  noegwan: '활성형 곱셈. 눈 5인 면 전용. 5가 윗면이면 누산 점수 ×2.2.',
  jeungpok: '활성형 곱셈. 눈 6인 면 전용. 6이 윗면이면 누산 점수 ×2.5. 활성 폭발 빌드의 핵심.',
  simcheung: '맞은편형: 이 면이 바닥면(윗면의 맞은편 슬롯)일 때만 발동. 눈 1~3 면 전용, +12. 맞은편 관계는 F1↔F6 · F2↔F5 · F3↔F4로 고정.',
  mugechu: '맞은편형. 짝수 눈 면 전용. 이 면이 바닥면이면 +13.',
  chimgang: '맞은편형. 눈 4~6 면 전용. 이 면이 바닥면이면 +15.',
  daeching: '맞은편형. 이 면이 바닥면이면 (윗면 눈 + 이 면 눈)만큼 더한다. 마주 보는 두 눈이 클수록 강하다.',
  banhyang: '맞은편형 곱셈. 이 면이 바닥면이면 누산 점수 ×2.0. 발동률 1/6이지만 조건이 없다.',
  wanjeon: '맞은편형 곱셈. 이 면이 바닥면이고 윗면 눈과 이 면 눈이 같으면 ×3.0 (다르면 미발동). 숫자 변경권으로 마주 보는 눈을 맞추는 "맞은편 대칭" 빌드의 완성형.',
  gyeotnal: '측면형: 이 면이 윗면도 바닥면도 아닌 옆 4면 중 하나일 때 발동 (가동률 4/6). +3.',
  cheugap: '측면형. 눈 4~6 면 전용. 측면 상태면 +4. 높은 눈을 굳이 띄우지 않아도 일한다.',
  geurimja: '측면형. 홀수 눈 면 전용. 측면 상태면 +4.',
  mugeum: '측면형 곱셈. 측면 상태면 누산 점수 ×1.3. 가동률 4/6의 배수 — 잠재 중첩 빌드의 상위 부품.',
  janhyang: '잠재형: 이 면이 윗면만 아니면 발동한다 (가동률 5/6). +2. 스타터 스킬 — "가려진 면도 일한다"의 기본형.',
  yeoun: '잠재형. 눈 1~3 면 전용. 윗면이 아니면 +3. 스타터 스킬 — 장착 조건의 존재를 가르친다.',
  jeoryu: '잠재형. 짝수 눈 면 전용. 윗면이 아니면 +3.',
  chukjeok: '잠재형. 윗면이 아니면 이 면 눈의 절반(내림)만큼 더한다. 눈 6 면에 두면 +3.',
  tongil: '잠재형. 윗면이 아니고, 모든 주사위의 활성 눈이 전부 홀수거나 전부 짝수면 +7.',
  miyeol: '잠재형 곱셈. 윗면이 아니면 누산 점수 ×1.2. 가동률 5/6 — 여러 장 쌓으면 상시 배수가 된다 (잠재 중첩 빌드의 엔진).',
  silseon: '잠재형 곱셈. 눈 1~3 면 전용. 윗면이 아니면 ×1.25.',
  jeoeum: '잠재형 곱셈. 짝수 눈 면 전용. 윗면이 아니면 ×1.25.',
  ssang: '활성형 (집합 참조). 이 면이 윗면이고, 모든 주사위의 활성 눈 중 같은 값이 2개 이상이면 +12.',
  yeonswae: '활성형 (집합 참조). 이 면이 윗면이고, 활성 눈들에 연속된 값이 3개 이상 있으면 +18 (예: 2·3·4).',
  sangae: '활성형 곱셈 (집합 참조). 이 면이 윗면이고 모든 활성 눈이 서로 다르면 ×1.8.',
  samjung: '활성형 곱셈 (집합 참조). 이 면이 윗면이고 활성 눈 중 같은 값이 3개 이상이면 ×2.2. 잠금으로 같은 눈을 모아야 한다.',
  gyeolsok: '잠재형 (자원 참조). 윗면이 아니면, 턴 종료 시점에 잠겨 있는 주사위 1개당 +3.',
  jeolje: '활성형 (자원 참조). 이 면이 윗면이면 남은 재굴림 1회당 +7. 재굴림을 아낄수록 강하다 — 조급과 상극.',
  yeoyu: '맞은편형 (자원 참조). 이 면이 바닥면이면 이번 턴을 제외한 남은 턴 1회당 +6. 이른 턴일수록 강하다.',
  jogeup: '활성형 곱셈 (자원 참조). 이 면이 윗면이고 이번 턴 재굴림을 모두 소진했다면 누산 점수 ×1.9. 절제와 상극.',
  gyedan: '잠재형 (순서 참조). 윗면이 아니면, 이 주사위보다 앞 순서의 주사위 1개당 +2. 뒷자리에 둘수록 강하다.',
  seonbong: '활성형 (순서 참조). 이 면이 윗면이고 이 주사위가 계산 순서 첫 번째일 때만 +16.',
  dohwaseon: '활성형 (누산기 참조). 눈 1~3 면 전용. 이 면이 윗면이고 이 스킬 차례까지의 누산 점수가 30 미만이면 +20. 앞 순서에 둬야 발동한다.',
  gwanseong: '활성형 곱셈 (누산기 참조). 이 면이 윗면이고 이 스킬 차례까지의 누산 점수가 60 이상이면 ×1.7. 뒷순서 + 덧셈 선행이 필요하다.',
  huwi: '활성형 곱셈 (순서 참조). 이 면이 윗면이고 이 주사위가 계산 순서 마지막일 때 ×2.2. 마지막 자리가 프리미엄인 이유.',
  banbok: '잠재형 (성장). 윗면이 아니면 발동하며, 이번 스테이지에서 발동한 횟수(이번 발동 포함)만큼 더한다. 1, 2, 3… 으로 커지고 스테이지가 끝나면 초기화된다.',
  seongjang: '활성형 (성장). 이 면이 윗면이면 현재 값만큼 더한다. +3으로 시작해 발동할 때마다 값이 영구히 +2 (스테이지를 넘어 유지).',
  gagin: '맞은편형 (성장). 이 면이 바닥면이면 현재 값만큼 더한다. +5로 시작해 스테이지를 클리어할 때마다 영구히 +5.',
  yeonma: '활성형 곱셈 (성장). 눈 6 면 전용. 6이 윗면이면 현재 배수만큼 곱한다. ×1.5로 시작해 발동할 때마다 배수가 영구히 +0.1.',
};
