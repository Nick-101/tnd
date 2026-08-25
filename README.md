# 주사위 덱빌딩 — 코어 매커니즘 검증 데모

6면체 주사위 5개의 면에 스킬을 장착해 덱을 만드는 로그라이크 덱빌딩 데모.
스테이지마다 4턴(턴당 굴림 3회, 잠금 자유) 안에 목표 점수를 달성하면 클리어, 8스테이지 완주 시 승리.

## 실행

빌드 도구 없음. 로컬 서버로 열면 된다 (ES 모듈이라 `file://` 직접 열기는 브라우저에 따라 차단될 수 있음):

```bash
python3 -m http.server 8000
# → http://localhost:8000/index.html
# 재현 가능한 판: http://localhost:8000/index.html?seed=123
```

## 구조

- `design/plan.md` — 기획서 (스킬 35종 표, 스테이지 목표, UI, 완료 기준)
- `index.html` + `css/style.css` — 화면 (발라트로풍, 애니메이션 없음, 마우스 전용)
- `js/config.js` — 상수·스킬·스테이지 데이터
- `js/game.js` — 순수 게임 로직 (DOM 의존 없음 → headless 테스트 가능)
- `js/render.js` — DOM 렌더러 / `js/main.js` — 조립
- `test/sim.test.mjs` — headless 검수 (완료 기준 1:1 + 스킬 수식 전수 + 풀게임 봇)
- `test/bot.mjs` — 검수용 자동 플레이 봇
- `progress.txt` — 검수·수정 이력

## 테스트

```bash
node test/sim.test.mjs
```
