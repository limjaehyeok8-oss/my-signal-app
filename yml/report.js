name: 리포트 JSON 만들기

on:
  schedule:
    - cron: "30 22 * * 0-5"   # 한국시간 월~토 오전 7:30
  workflow_dispatch:           # 수동 실행 버튼

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: 라이브러리 설치
        run: pip install yfinance pandas numpy requests lxml

      - name: 리포트 계산
        env:
          FINNHUB_TOKEN: ${{ secrets.FINNHUB_TOKEN }}
        run: python report.py

      - name: report.json 커밋
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add report.json
          git diff --cached --quiet || (git commit -m "update report.json" && git push)
