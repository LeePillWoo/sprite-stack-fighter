# Sprite Stack Fighter

`fighter.html` 하나로 실행되는 픽셀아트 공중전 데모. 3D 엔진·폴리곤·외부 파일 없이 Canvas 2D 프레임버퍼에 직접 그린다.

**`fighter.html` 은 빌드 결과물이다. 직접 고치지 말고 아래 소스를 고친 뒤 다시 빌드한다.**

```
node tools/build.mjs        # src/ + parts/ → fighter.html
node tools/smoke.mjs        # 헤드리스로 45초 비행시켜 깨지는 곳이 없는지 확인
node tools/bench.mjs        # 시점별 프레임 시간
node tools/flicker.mjs      # 움직임 보정(끔/약/강)별 화면 반짝임 측정
node tools/build_jets.mjs   # design/*_jet_orthos.png → parts/jets.js (기체 4면도에서 복셀 추출)
```

| 경로 | 내용 |
|---|---|
| `src/engine.js` | 렌더러(높이맵 컬럼 렌더러 + 복셀 스택 기체), 비행, 전투 |
| `src/main.js`, `src/shell.html` | 캔버스·입력·루프, 페이지 껍데기 |
| `parts/cockpit.js` | 조종석·HUD 아트 (`buildCockpit`, `drawCockpit`) |
| `parts/jets.js` | 기체 복셀 데이터 (자동 생성) |
| `design/` | Codex 가 만든 디자인 시안 |

주소 뒤에 `?debug` 를 붙이면 fps 가 보이고, `?tier=1` 처럼 주면 해상도 단계를 고정한다.
