// TnD 결합 데모 — 설정·데이터 (기획안 결합 v2.2). 로직은 tnd-game.js가 해석한다.
import { SKILLS, SKILL_DETAILS } from './config.js';

export const TND = {
  BOARD_SIZE: 32, START_CELL: 0,
  DICE: 3,                    // v2: 주사위 3개
  ROLLS_PER_TURN: 3,          // 자동 굴림 1 + 재굴림 2
  GAUGE: 10, COMBO_MAX: 9,
  PLAYER_START_FAITH: 0,
  CORRUPT_COUNTER: 3,
  DESTROY_MULT: 1.5,
  DECK_SIZE: 5, MAX_GRADE: 6,
  PURIFY_START: 1, PURIFY_STEP: 2,
  STOP_DISCOUNT: 0.5,         // 이번 턴 멈춘 칸의 업그레이드 = (비용÷2)×0.5 = 비용÷4 · 밟기만 한 칸은 비용÷2 · 지나가지 않은 기물은 불가
  REPEAT_CAP: 15,
  HOME_RANGE: 8,              // '귀향': 시작칸에서 8칸 이내
  LAP_MOVE_CAP: 60,           // 한 바퀴 해석의 패턴 이동 상한 (종탑·거울 무한 루프 방지) — 초과하면 탈출 처리
};

export const ceil = n => Math.ceil(n - 1e-9);
export const upgradeCost = (def, stopped) => ceil(def.cost / 2 * (stopped ? TND.STOP_DISCOUNT : 1));
export const sellPrice = (def, g) => ceil(def.cost * g / 2);
export const enemyPieceCost = (g, m) => 2 * g + g * m;

// ── 몬스터 (데이터 정의 — 정의 하나 추가 = 새 몬스터). 이동만 하며, 웨이브 단계에 한 바퀴를 한 번에 돈다. HP는 웨이브 표가 정한다.
// leak.type: erode(잠식) | corrode(부식) | nest(둥지) · leak.placement: emptyRandom | pieceFirst | highestPiece | nearStart | consecutive
export const MONSTERS = {
  pilgrim:  { id: 'pilgrim',  name: '순례자', icon: '○', moveMode: 'basic', pattern: [5, 4, 6, 5], leak: { count: 1, type: 'erode',   placement: 'emptyRandom' } },
  raider:   { id: 'raider',   name: '약탈자', icon: '◇', moveMode: 'basic', pattern: [7, 6, 8],    leak: { count: 2, type: 'corrode', placement: 'pieceFirst' } },
  leaper:   { id: 'leaper',   name: '도약자', icon: '◆', moveMode: 'jump',  pattern: [6, 6, 8],    leak: { count: 2, type: 'erode',   placement: 'nearStart' } },
  colossus: { id: 'colossus', name: '거체',   icon: '□', moveMode: 'slow',  pattern: [3, 3, 4],    leak: { count: 1, type: 'nest',    placement: 'highestPiece' } },
};
// 웨이브 12: 내 턴 하나 = 웨이브 하나. monsters 순서 = 해석 순서. 마지막은 보스(탈출 = 패배).
// HP = 기획안 §8.6 표(중급 피해 중앙값 × 0.7) × HP_RATIO. 본 구현은 몬스터 이동 방식(점프·서행)까지 해석하므로 §18.4 노브 1로 0.7 → 0.5 (progress.txt 반복 10)
export const HP_RATIO = 0.5 / 0.7;
const W = (hp, ...ids) => ({ monsters: ids.map(defId => ({ defId, hp: Math.max(1, Math.round(hp * HP_RATIO)) })) });
export const WAVES = [
  W(3, 'pilgrim'), W(10, 'pilgrim'), W(25, 'raider'), W(35, 'pilgrim'), W(55, 'raider', 'raider'), W(70, 'colossus'),
  W(85, 'pilgrim', 'raider'), W(100, 'leaper'), W(115, 'raider', 'raider', 'raider'), W(130, 'colossus', 'pilgrim'), W(145, 'leaper', 'raider'),
  { monsters: [{ defId: 'colossus', hp: Math.round(155 * HP_RATIO), boss: true, name: '대주교' }] },
];
// 타락 유형: 카운터 0에서의 처리
export const CORRUPT_TYPES = {
  erode:   { name: '잠식', counter: 3, desc: '카운터 3 → 사악한 기물 G1 (이미 있으면 +1)' },
  corrode: { name: '부식', counter: 2, desc: '카운터 2 → 그 칸의 내 기물만 파괴 (빈 칸이면 잠식과 동일)' },
  nest:    { name: '둥지', counter: 4, desc: '카운터 4 → 사악한 기물 G2 (이미 있으면 +2)' },
};
export const PLACEMENT_LABEL = { emptyRandom: '빈 칸 무작위', pieceFirst: '기물 있는 칸 우선', highestPiece: '최고 등급 기물 칸', nearStart: '시작칸 앞 8칸 이내', consecutive: '연속 칸' };
export const leakLabel = leak => `${CORRUPT_TYPES[leak.type].name} ${leak.count} · ${PLACEMENT_LABEL[leak.placement]}`;

// ── 각인 18종 (주사위당 1, 중복 불가). kind: move | roll | settle | board
export const ENGRAVINGS = [
  { id: 'doyak',   name: '도약',   kind: 'move',   moveMode: 'teleport', desc: '순간이동으로 이동 (경유 없음)' },
  { id: 'biyak',   name: '비약',   kind: 'move',   moveMode: 'jump',     desc: '점프(2)로 이동 (2칸마다 밟음)' },
  { id: 'sullye',  name: '순례',   kind: 'move',   moveMode: 'slow',     desc: '서행으로 이동 (경유 칸마다 밟음+멈춤)' },
  { id: 'eunsin',  name: '은신',   kind: 'move',   moveMode: 'stealth',  desc: '은밀 이동 (아무것도 발동하지 않음)' },
  { id: 'hwalbo',  name: '활보',   kind: 'move',   moveMode: 'basic', extra: 1, desc: '기본 이동, 거리 +1' },
  { id: 'jaedo',   name: '재도',   kind: 'roll',   desc: '두 번 굴려 높은 쪽을 취한다' },
  { id: 'innae',   name: '인내',   kind: 'roll',   desc: '잠긴 채로 턴을 넘기면 눈 +1 (최대 6, 굴리면 원래대로)' },
  { id: 'bulgul',  name: '불굴',   kind: 'roll',   desc: '1이 나오면 한 번 더 굴린다' },
  { id: 'gyunhyeong', name: '균형', kind: 'roll',  desc: '재굴림 시 직전과 다른 눈만 나온다' },
  { id: 'gongheo', name: '공허',   kind: 'settle', desc: '이 주사위의 잠재면 스킬 효과 2배 (+는 2배, ×는 제곱)' },
  { id: 'jongjang', name: '종장',  kind: 'settle', desc: '항상 마지막에 계산된다' },
  { id: 'seojang', name: '서장',   kind: 'settle', desc: '항상 처음에 계산된다' },
  { id: 'jjakheart', name: '짝의 심장', kind: 'settle', desc: '눈이 짝수면 이 주사위 계산 후 누산기 ×1.2' },
  { id: 'heonsin', name: '헌신',   kind: 'settle', desc: '활성면에 스킬이 없으면 눈을 3배로 취급' },
  { id: 'chukbok', name: '축복',   kind: 'board',  desc: '이 주사위로 이동 시 밟은 내 기물을 등급 +1로 취급' },
  { id: 'jeonghwabal', name: '정화의 발걸음', kind: 'board', desc: '이 주사위로 멈춘 칸의 타락 카운터 +2' },
  { id: 'gaecheok', name: '개척',  kind: 'board',  desc: '이 주사위로 멈춘 빈 칸의 건설 비용 −30%' },
  { id: 'jingsu',  name: '징수',   kind: 'board',  desc: '이 주사위로 멈춘 적 기물의 강제지불 절반' },
];
export const ENGRAVINGS_BY_ID = Object.fromEntries(ENGRAVINGS.map(e => [e.id, e]));
export const ENGRAVING_KIND_LABEL = { move: '이동', roll: '굴림', settle: '정산', board: '보드' };
export const MOVE_MODE_LABEL = { basic: '기본', teleport: '순간이동', jump: '점프(2)', slow: '서행', stealth: '은밀' };
export const ENGRAVING_DETAILS = {
  doyak: '이동형. 이 주사위로 이동하면 경유 칸을 밟지 않고 도착 칸만 밟음+멈춤 처리한다. 적 기물 밀집 구간을 건너뛰어 원하는 칸에 착지하는 용도.',
  biyak: '이동형. 2칸마다 한 번씩 밟고, 도착 칸은 밟음+멈춤. 경로의 절반만 발동시킨다.',
  sullye: '이동형. 경유하는 모든 칸에서 밟음과 멈춤을 처리한다 — 내 기물의 멈춤 효과를 줄줄이 터뜨리지만, 경로의 적 기물마다 강제지불하고 타락마다 정화 창이 뜬다.',
  eunsin: '이동형. 경유·도착 어디서도 아무 효과도 발동하지 않는 순수 재배치. 마지막 구간에 쓰면 최종 칸의 멈춤 자체가 사라진다.',
  hwalbo: '이동형. 기본 이동이지만 이 주사위의 거리가 항상 +1. 최종 도착 칸을 한 칸 밀어내는 유일한 각인.',
  jaedo: '굴림형. 이 주사위는 굴릴 때마다 두 번 굴려 더 높은 눈을 취한다 (재굴림 포함).',
  innae: '굴림형. 잠근 채로 턴을 넘기면 다음 턴에도 잠긴 상태로 유지되며 눈 +1 (최대 6). 굴리면 보너스가 사라진다.',
  bulgul: '굴림형. 굴려서 1이 나오면 한 번 더 굴린다 (두 번째 결과를 그대로 취한다).',
  gyunhyeong: '굴림형. 재굴림하면 직전 윗면과 다른 면만 나온다 (턴 시작 굴림에는 적용 안 됨).',
  gongheo: '정산형. 이 주사위의 잠재면(윗면이 아닌 면) 스킬 효과를 2배로 — 덧셈은 2배, 곱셈은 제곱. 잠재 곱셈 빌드의 엔진.',
  jongjang: '정산형. 계산 순서와 무관하게 이 주사위를 항상 마지막에 계산한다. 곱셈 스킬을 몰아둘 자리.',
  seojang: '정산형. 이 주사위를 항상 처음에 계산한다. 덧셈·도화선(누산 30 미만) 스킬용.',
  jjakheart: '정산형. 이 주사위의 눈이 짝수면, 이 주사위의 면 스킬을 모두 적용한 뒤 누산기를 ×1.2 한다.',
  heonsin: '정산형. 활성면(윗면)에 스킬이 없으면 이 주사위의 눈을 3배로 취급해 기본 눈합에 넣는다. 눈 6이면 18.',
  chukbok: '보드형. 이 주사위로 이동하는 동안 밟거나 멈춘 내 기물을 등급 +1로 취급한다 (최대 6).',
  jeonghwabal: '보드형. 이 주사위로 멈춘 칸이 타락이면 카운터 +2 (정화 창은 그대로 뜬다).',
  gaecheok: '보드형. 이 주사위로 멈춘 빈 칸에 건설할 때 비용 −30% (올림).',
  jingsu: '보드형. 이 주사위로 멈춘 칸의 사악한 기물 강제지불이 절반(올림)이 된다.',
};

// ── 면 스킬 52종: v1 57종에서 이동 계층 5종 제외, 귀향·각인의 기억 재정의
const REMOVED = new Set(['yeoyu']);
const OVERRIDE = {
  banbok: { desc: '이번 고행에서 발동한 횟수만큼 + (최대 +15)' },
  gagin: { name: '각인의 기억', desc: '+5로 시작, 내 말이 한 바퀴 돌 때마다 +3', kind: 'growStage', step: 3 },
  chukjeok: { desc: '이 면 눈의 절반(올림)만큼 +' },
  yeonswae: { desc: '활성 눈 3개가 연속이면 +18' },
  sangae: { desc: '활성 눈 3개가 서로 다르면 ×1.8' },
  samjung: { desc: '활성 눈 3개가 모두 같으면 ×2.2' },
};
const NEW_SKILLS = [
  { id: 'shindo',    name: '신도', grade: 'advanced', layer: 'opposite', cond: { kind: 'any' },  op: 'add', kind: 'perPiece', v: 3, desc: '보드 위 내 기물 1개당 +3' },
  { id: 'seongjeon', name: '성전', grade: 'advanced', layer: 'active',   cond: { kind: 'any' },  op: 'add', kind: 'perPiece', v: 3, desc: '보드 위 내 기물 1개당 +3' },
  { id: 'sungyo',    name: '순교', grade: 'advanced', layer: 'latent',   cond: { kind: 'any' },  op: 'add', kind: 'perCorrupt', v: 2, desc: '보드 위 타락 칸 1개당 +2' },
  { id: 'eungjing',  name: '응징', grade: 'rare',     layer: 'active',   cond: { kind: 'high' }, op: 'mul', kind: 'perEnemyPieceMult', v: 1.15, desc: '보드 위 사악한 기물 1개당 ×1.15' },
  { id: 'gwihyang',  name: '귀향', grade: 'advanced', layer: 'opposite', cond: { kind: 'any' },  op: 'add', kind: 'homeNear', v: 12, desc: '내 말이 시작칸에서 8칸 이내에 있으면 +12' },
];
export const TND_SKILLS = [
  ...SKILLS.filter(s => !REMOVED.has(s.id)).map(s => ({ ...s, ...(OVERRIDE[s.id] || {}) })),
  ...NEW_SKILLS,
];
export const TND_SKILLS_BY_ID = Object.fromEntries(TND_SKILLS.map(s => [s.id, s]));
export const TND_LAYER_LABEL = { active: '활성', opposite: '맞은편', side: '측면', latent: '잠재' };
export const TND_SKILL_DETAILS = {
  ...SKILL_DETAILS,
  chukjeok: '잠재형. 윗면이 아니면 이 면 눈의 절반(올림)만큼 더한다. 결합판은 모든 소수점을 올림 처리한다.',
  banbok: '잠재형 (성장). 윗면이 아니면 발동하며, 이번 고행에서 발동한 횟수(이번 발동 포함)만큼 더한다. 최대 +15. 고행 시작 시 초기화.',
  gagin: '맞은편형 (성장). 이 면이 바닥면이면 현재 값만큼 더한다. +5로 시작해 내 말이 시작칸을 지나 한 바퀴 돌 때마다 +3 (턴당 약 10칸 이동하므로 3턴에 한 바퀴). 고행 시작 시 초기화.',
  seongjang: '활성형 (성장). 이 면이 윗면이면 현재 값만큼 더한다. +3으로 시작해 발동할 때마다 +2. 고행 시작 시 초기화.',
  yeonma: '활성형 곱셈 (성장). 눈 6 면 전용. 6이 윗면이면 현재 배수만큼 곱한다. ×1.5로 시작해 발동마다 +0.1. 고행 시작 시 초기화.',
  yeonswae: '활성형 (집합 참조). 주사위가 3개이므로 활성 눈 3개가 연속(예: 2·3·4)이면 +18.',
  sangae: '활성형 곱셈 (집합 참조). 활성 눈 3개가 서로 다르면 ×1.8.',
  samjung: '활성형 곱셈 (집합 참조). 활성 눈 3개가 모두 같으면 ×2.2. 잠금으로 같은 눈을 모아야 한다.',
  shindo: '맞은편형 (자원 참조). 이 면이 바닥면이면 보드 위 내 기물 1개당 +3.',
  seongjeon: '활성형 (보드 참조). 이 면이 윗면이면 보드 위 내 기물 1개당 +3.',
  sungyo: '잠재형 (보드 참조). 윗면이 아니면 보드 위 타락 칸 1개당 +2.',
  eungjing: '활성형 곱셈 (보드 참조). 눈 4~6 면 전용. 이 면이 윗면이면 보드 위 사악한 기물 1개당 ×1.15 (곱으로 중첩).',
  gwihyang: '맞은편형 (보드 참조). 이 면이 바닥면이고 내 말이 시작칸(0)에서 시계·반시계 어느 쪽으로든 8칸 이내에 있으면 +12.',
};

// ── 기물 11종 (기획안 §13.1: 기준선 3 + 경로 조작 6 + 경제·오라 2). 기물은 동사를 하나 가진다. 효과 로직은 tnd-game.js(resolveLap / 플레이어 큐)
export const TIER_LABEL = ['', 'I', 'II', 'III', 'IV', 'V'];
export const PIECES = [
  { id: 'altar',     name: '제단',   tier: 1, cost: 3,   verb: '때린다',   hooks: ['foePass', 'foeStop', 'myStop'], desc: '적밟: −G · 적멈: −3G · 내멈: 신앙 +1' },
  { id: 'sanctum',   name: '성소',   tier: 2, cost: 10,  verb: '때린다',   hooks: ['foePass', 'foeStop'],           desc: '적밟: −2G · 적멈: −6G' },
  { id: 'spire',     name: '첨탑',   tier: 3, cost: 60,  verb: '때린다',   hooks: ['foePass', 'foeStop'],           desc: '적밟: −G² · 적멈: −3G²' },
  { id: 'decoy',     name: '미끼',   tier: 1, cost: 4,   verb: '유인한다', hooks: ['foePass'],                      desc: '몬스터의 다음 도착 칸이 이 칸에서 G칸 이내면 여기서 멈춘다. 남은 이동은 소멸' },
  { id: 'swamp',     name: '늪',     tier: 1, cost: 3,   verb: '늦춘다',   hooks: ['foePass'],                      desc: '적밟: 그 몬스터의 다음 이동 −G칸 (최소 1)' },
  { id: 'gate',      name: '성문',   tier: 2, cost: 12,  verb: '막는다',   hooks: ['foePass'],                      desc: '몬스터는 이 칸을 지나칠 수 없다 — 이동이 여기서 끝난다(멈춤 판정). 닫힘 횟수 = G, 0이면 열린 문. 업그레이드 = 재장전' },
  { id: 'bell',      name: '종탑',   tier: 2, cost: 12,  verb: '되돌린다', hooks: ['foeStop'],                      desc: '적멈: 그 몬스터를 2G칸 뒤로 (되돌아간 칸은 밟지 않음)' },
  { id: 'passage',   name: '통로',   tier: 2, cost: 8,   verb: '연결한다', hooks: ['foeStop', 'myStop'], pair: true, desc: '두 개를 지어야 작동. 몬스터가 한쪽에 멈추면 다른 쪽으로 이동(사이 칸은 밟지 않음, 멈춤 판정은 도착한 통로에서, 바퀴당 1회). 내멈: 다른 통로로 순간이동을 선택할 수 있다' },
  { id: 'mirror',    name: '거울',   tier: 3, cost: 60,  verb: '반사한다', hooks: ['foeStop'],                      desc: '적멈: 그 몬스터의 다음 이동이 역방향. 방금 지나온 내 기물을 거꾸로 다시 밟는다 (역방향 시작칸 통과는 탈출이 아님)' },
  { id: 'well',      name: '우물',   tier: 1, cost: 3,   verb: '채운다',   hooks: ['myPass', 'myStop'],             desc: '내밟: 게이지 +G · 내멈: 게이지 +3G (10 초과분은 버림)' },
  { id: 'cathedral', name: '대성당', tier: 4, cost: 400, verb: '증폭한다', hooks: ['aura', 'foeStop'],              desc: '오라: 좌우 2칸 기물의 모든 효과 ×2 · 적멈: −10G' },
];
export const PIECES_BY_ID = Object.fromEntries(PIECES.map(p => [p.id, p]));
export const PIECE_DETAILS = {
  altar: '기준선. 적이 밟으면 −G, 멈추면 −3G. 내가 멈추면 신앙 +1. 3신앙짜리라 첫 턴부터 깔 수 있고, 밟은 칸이면 등급당 2(멈춘 칸 1)로 올린다.',
  sanctum: '기준선. 적밟 −2G, 적멈 −6G. 제단의 2배 효율에 3배 가격.',
  spire: '기준선. 적밟 −G², 적멈 −3G². G6이면 밟음 36, 멈춤 108 — 서행 몬스터(거체)에게 주는 보상.',
  decoy: '경로 조작. 몬스터가 이 칸을 밟을 때, 그 이동의 도착 칸이 이 칸에서 앞으로 G칸 이내면 여기서 멈추고 남은 이동은 사라진다. 웨이브 프리뷰의 ★이 이 칸으로 옮겨온다. 성문이 먼저 판정된다.',
  swamp: '경로 조작. 적이 밟으면 그 몬스터의 다음 이동 거리가 −G (최소 1). 여러 늪을 밟으면 누적. 대성당 오라 범위면 −2G.',
  gate: '경로 조작. 닫힌 성문(닫힘 > 0)을 몬스터가 밟으면 그 자리에서 이동이 끝나고(멈춤 판정) 닫힘 −1. 0이 되면 열린 문이 되어 효과가 없다. 업그레이드하면 닫힘이 새 등급으로 재장전된다. 여러 마리 웨이브에서는 앞 마리가 먼저 소모한다.',
  bell: '경로 조작. 적이 멈추면 2G칸 뒤로 보낸다. 되돌아간 칸은 밟지 않고, 후퇴한 자리에서 멈춤 처리도 없다. 서행 몬스터는 다시 돌아오므로 그만큼 더 맞는다.',
  passage: '경로 조작. 두 개가 있어야 작동. 몬스터가 한쪽에 멈추면 다른 통로로 옮겨지고(사이 칸은 밟지 않음) 그곳에서 멈춤 판정. 몬스터당 바퀴에 1회. 뒤쪽 통로로 보내면 그만큼 더 돌게 된다(되감기). 내가 멈추면 다른 통로로 순간이동할지 고를 수 있다.',
  mirror: '경로 조작. 적이 멈추면 그 몬스터의 다음 이동이 역방향이 된다 — 방금 지나온 내 기물을 거꾸로 다시 밟는다. 역방향으로 시작칸을 지나는 것은 탈출이 아니며 그만큼 더 돈다.',
  well: '경제. 내가 밟으면 게이지 +G, 멈추면 +3G (10 초과분은 버림). 서행·축복 각인과 어울린다.',
  cathedral: '오라. 좌우 2칸 기물의 모든 수치 효과(피해·늪·종탑·미끼 범위·우물)를 2배로. 적이 멈추면 −10G.',
};

// 권장 입문 빌드 / 입문 덱 (§13, §18) — 정비 초기 프리셋. 각인은 비워 둔다 (플레이어 선택)
export const STARTER_BUILD = { 0: { 5: 'jungta', 0: 'janhyang' }, 1: { 5: 'gangta', 1: 'yeoun' }, 2: { 2: 'gyeotnal', 0: 'miyeol' } };
export const STARTER_DECK = ['altar', 'sanctum', 'decoy', 'gate', 'spire'];
