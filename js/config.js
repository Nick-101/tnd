// 게임 상수 및 데이터 정의 (로직 없음 — game.js가 해석한다)

export const DICE_COUNT = 5;
export const FACE_COUNT = 6;
export const FACE_MIN = 1;
export const FACE_MAX = 9;
export const TURNS_PER_STAGE = 4;
export const ROLLS_PER_TURN = 3; // 턴 시작 자동 굴림 1회 포함
export const REWARD_SKILL_COUNT = 3;
export const REWARD_TICKET_COUNT = 2;

// 스테이지별 목표 점수
export const STAGE_TARGETS = [70, 100, 200, 240, 310, 400, 500, 620];

// 장착 조건: any | low(3 이하) | high(4 이상) | even | odd | exact(n)
// 효과: game.js의 applyEffect / applyTotalEffect가 type별로 해석
export const SKILLS = [
  { id: 'coin',      name: '잔돈 줍기',     cond: { kind: 'any' },          effect: { type: 'flat', v: 8 },          desc: '눈 +8' },
  { id: 'heavy',     name: '묵직한 한 방',  cond: { kind: 'high' },         effect: { type: 'flat', v: 15 },          desc: '눈 +15' },
  { id: 'grit',      name: '밑바닥 근성',   cond: { kind: 'low' },          effect: { type: 'flat', v: 18 },          desc: '눈 +18' },
  { id: 'evenx2',    name: '짝수 예찬',     cond: { kind: 'even' },         effect: { type: 'mult', v: 4 },          desc: '눈 ×4' },
  { id: 'oddx2',     name: '홀수 반란',     cond: { kind: 'odd' },          effect: { type: 'mult', v: 4 },          desc: '눈 ×4' },
  { id: 'trinity',   name: '삼위일체',      cond: { kind: 'exact', n: 3 },  effect: { type: 'mult', v: 6 },          desc: '눈 ×6' },
  { id: 'lotto',     name: '로또',          cond: { kind: 'exact', n: 6 },  effect: { type: 'mult', v: 6 },          desc: '눈 ×6' },
  { id: 'ant',       name: '개미 군단',     cond: { kind: 'exact', n: 1 },  effect: { type: 'flat', v: 35 },         desc: '눈 +35' },
  { id: 'twin',      name: '쌍둥이 자석',   cond: { kind: 'any' },          effect: { type: 'perMatchOther', v: 15 }, desc: '같은 눈인 다른 주사위 하나당 +15' },
  { id: 'evenally',  name: '짝수 동맹',     cond: { kind: 'even' },         effect: { type: 'perEvenAll', v: 12 },    desc: '짝수 눈 주사위 하나당 +12 (자신 포함)' },
  { id: 'oddally',   name: '홀수 동맹',     cond: { kind: 'odd' },          effect: { type: 'perOddAll', v: 12 },     desc: '홀수 눈 주사위 하나당 +12 (자신 포함)' },
  { id: 'freeride',  name: '어부지리',      cond: { kind: 'any' },          effect: { type: 'maxOtherX2' },            desc: '다른 주사위 중 가장 높은 눈 ×2 만큼 +' },
  { id: 'hyena',     name: '하이에나',      cond: { kind: 'low' },          effect: { type: 'minOtherX3' },          desc: '다른 주사위 중 가장 낮은 눈 ×3 만큼 +' },
  { id: 'blessing',  name: '합의 축복',     cond: { kind: 'any' },          effect: { type: 'sumAll' },          desc: '모든 주사위 눈의 합만큼 +' },
  { id: 'lonewolf',  name: '외로운 늑대',   cond: { kind: 'any' },          effect: { type: 'uniqueMult', v: 5 },    desc: '같은 눈이 하나도 없으면 눈 ×5' },
  { id: 'crowd',     name: '군중 심리',     cond: { kind: 'any' },          effect: { type: 'crowdMult', v: 8 },     desc: '같은 눈이 2개 이상 더 있으면 눈 ×8' },
  { id: 'ladder',    name: '계단 오르기',   cond: { kind: 'any' },          effect: { type: 'ladder', v: 25 },       desc: '내 눈보다 1 큰 눈의 주사위가 있으면 +25' },
  { id: 'pureeven',  name: '순혈 짝수',     cond: { kind: 'even' },         effect: { type: 'noOddMult', v: 5 },     desc: '홀수 눈 주사위가 없으면 눈 ×5' },
  { id: 'pureodd',   name: '순혈 홀수',     cond: { kind: 'odd' },          effect: { type: 'noEvenMult', v: 5 },    desc: '짝수 눈 주사위가 없으면 눈 ×5' },
  { id: 'juggler',   name: '저글러',        cond: { kind: 'any' },          effect: { type: 'perLocked', v: 12 },     desc: '턴 종료 시 잠긴 주사위 하나당 +12' },
  { id: 'gambler',   name: '도박사',        cond: { kind: 'any' },          effect: { type: 'noLockedMult', v: 4 },  desc: '잠긴 주사위가 없으면 눈 ×4' },
  { id: 'sixbros',   name: '육형제',        cond: { kind: 'any' },          effect: { type: 'perSix', v: 18 },        desc: '눈이 6인 주사위 하나당 +18 (자신 포함)' },
  { id: 'sniper',    name: '스나이퍼',      cond: { kind: 'exact', n: 5 },  effect: { type: 'mult', v: 8 },          desc: '눈 ×8' },
  { id: 'objection', name: '이의 있음',     cond: { kind: 'exact', n: 2 },  effect: { type: 'mult', v: 9 },          desc: '눈 ×9' },
  { id: 'shooter',   name: '사수',          cond: { kind: 'exact', n: 4 },  effect: { type: 'flat', v: 20 },          desc: '눈 +20' },
  { id: 'richer',    name: '부익부',        cond: { kind: 'high' },         effect: { type: 'perHigh', v: 10 },       desc: '눈 4 이상 주사위 하나당 +10 (자신 포함)' },
  { id: 'poorer',    name: '빈익빈',        cond: { kind: 'low' },          effect: { type: 'perLow', v: 10 },        desc: '눈 3 이하 주사위 하나당 +10 (자신 포함)' },
  { id: 'orchestra', name: '오케스트라',    cond: { kind: 'any' },          effect: { type: 'totalMultEven4', v: 2 },   desc: '짝수 눈이 4개 이상이면 총점 ×2' },
  { id: 'shaman',    name: '무당',          cond: { kind: 'any' },          effect: { type: 'totalMultOdd4', v: 2 },    desc: '홀수 눈이 4개 이상이면 총점 ×2' },
  { id: 'fivestar',  name: '파이브 스타',   cond: { kind: 'any' },          effect: { type: 'totalMultTriple', v: 3 },  desc: '같은 눈이 3개 이상이면 총점 ×3' },
  { id: 'finale',    name: '그랜드 피날레', cond: { kind: 'exact', n: 6 },  effect: { type: 'totalFlat', v: 60 },    desc: '총점 +60' },
  { id: 'bastion',   name: '최후의 보루',   cond: { kind: 'exact', n: 1 },  effect: { type: 'totalFlat', v: 50 },    desc: '총점 +50' },
  { id: 'hoarder',   name: '수집광',        cond: { kind: 'any' },          effect: { type: 'perEquipped', v: 3 },   desc: '주사위들에 장착된 스킬 하나당 +3' },
  { id: 'veteran',   name: '베테랑',        cond: { kind: 'any' },          effect: { type: 'perStage', v: 6 },      desc: '현재 스테이지 번호 ×6 만큼 +' },
  { id: 'snowball',  name: '눈덩이',        cond: { kind: 'any' },          effect: { type: 'fifthScore' },          desc: '현재 스테이지 점수의 1/5만큼 + (내림)' },
];

export const SKILLS_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));

// 장착 조건 검사: 면의 숫자 value에 이 스킬을 둘 수 있는가
export function condAllows(cond, value) {
  switch (cond.kind) {
    case 'any': return true;
    case 'low': return value <= 3;
    case 'high': return value >= 4;
    case 'even': return value % 2 === 0;
    case 'odd': return value % 2 === 1;
    case 'exact': return value === cond.n;
    default: return false;
  }
}

export function condLabel(cond) {
  switch (cond.kind) {
    case 'any': return '모두';
    case 'low': return '3 이하';
    case 'high': return '4 이상';
    case 'even': return '짝수';
    case 'odd': return '홀수';
    case 'exact': return `${cond.n}만`;
    default: return '?';
  }
}
