// ==========================================================
// Verdict.gs — AI 지표 점수 (개선판)
// 기존 getAiVerdict 와 같은 입력/출력. 호출부에서 이름만 getAiVerdict2 로 바꾸면 됨.
//
// 바뀐 점
//  1) 비슷한 정보를 여러 번 세던 걸 "그룹"으로 묶고 그룹마다 상한을 둠
//     (추세 ±5 / 힘(모멘텀) ±3 / 위험·이벤트 ±6)
//  2) 과매도(스토캐스틱 바닥)를 감점하지 않음 → 저점매수 구간을 점수가 깎지 않게
//  3) 점수가 낮아도 '과매도 반등 후보' 인 경우 따로 알려줌
//  4) 요약 문구를 구체적으로, 봇 신호와 별개라는 점 표시
// ==========================================================
function getAiVerdict2(cp, ma20, rsiD, rsiW, divMsg, isHooked, isVolExhausted, haDaily, haWeekly, shortStop, longStop,
                       currMacd, prevMacd, prev2Macd, currStoch, prevStoch, bbUpper, isHighpointSell, isVolumeSurge, isDailyBullForVol) {
  var hD = haDaily.closes.length, hW = haWeekly.closes.length;
  var dailyBull = hD > 0 && haDaily.closes[hD - 1] > haDaily.opens[hD - 1];
  var weeklyBull = hW > 0 && haWeekly.closes[hW - 1] > haWeekly.opens[hW - 1];
  var weeklyBullPrev = hW > 1 && haWeekly.closes[hW - 2] > haWeekly.opens[hW - 2];
  var streak = 0;
  if (weeklyBull) { for (var wi = hW - 1; wi >= 0; wi--) { if (haWeekly.closes[wi] > haWeekly.opens[wi]) streak++; else break; } }
  var dist = (cp - ma20) / ma20;

  function cap(v, lim) { return Math.max(-lim, Math.min(lim, v)); }
  var G = {
    trend: {name: "추세", lim: 5, sum: 0, plus: [], minus: []},
    mom:   {name: "힘(모멘텀)", lim: 3, sum: 0, plus: [], minus: []},
    risk:  {name: "위험·이벤트", lim: 6, sum: 0, plus: [], minus: []}
  };
  function add(g, v, txt) {
    G[g].sum += v;
    (v >= 0 ? G[g].plus : G[g].minus).push(txt + " (" + (v >= 0 ? "+" : "") + v + ")");
  }

  // ---- 추세 ----
  if (cp > ma20) add("trend", 1, "현재가가 20일선 위"); else add("trend", -1, "현재가가 20일선 아래");
  if (dailyBull) add("trend", 1, "일봉(하이킨) 양봉 - 단기 상승"); else add("trend", -1, "일봉(하이킨) 음봉 - 단기 하락");
  if (weeklyBull && weeklyBullPrev) add("trend", 3, "주봉 " + streak + "주 연속 양봉 - 큰 흐름 상승");
  else if (weeklyBull) add("trend", 1, "주봉 첫 양봉 전환");
  else add("trend", -3, "주봉 음봉 - 큰 흐름 하락");

  // ---- 힘(모멘텀) ----
  if (prevMacd > 0 && currMacd <= 0) add("mom", -2, "MACD 하락 전환(데드크로스)");
  else if (prevMacd < 0 && currMacd >= 0) add("mom", 2, "MACD 상승 전환(골든크로스)");
  else if (prevMacd > 0 && currMacd > 0 && currMacd < prevMacd) add("mom", -1, "MACD 상승 힘 약해지는 중");
  else if (prevMacd < 0 && currMacd < 0 && currMacd > prevMacd) add("mom", 1, "MACD 하락 힘 줄어드는 중");
  if (prevStoch <= 20 && currStoch > 20) add("mom", 1, "스토캐스틱RSI 바닥 탈출");
  else if (prevStoch >= 80 && currStoch < 80) add("mom", -1, "스토캐스틱RSI 과열권에서 내려옴");

  // ---- 위험·이벤트 ----
  if (shortStop && cp < shortStop && !dailyBull) add("risk", -1, "단기 전환점 이탈");
  if (longStop && cp < longStop && !weeklyBull) add("risk", -2, "장기 지지선 이탈");
  else if (longStop && cp <= longStop * 1.03 && cp >= longStop) add("risk", 1, "장기 지지선 바로 위 (손실 폭 작음)");
  if (isHighpointSell) add("risk", -4, "🌋 주봉 과열 후 반전 확정");
  if (isVolumeSurge) {
    if (isDailyBullForVol) add("risk", 2, "📊 거래량 급증하며 상승");
    else add("risk", -2, "📊 거래량 급증하며 하락");
  }
  if (divMsg && isHooked) {
    if (divMsg.indexOf("상승") !== -1) add("risk", 2, "상승 다이버전스 확인");
    else add("risk", -2, "하락 다이버전스 확인");
  }
  if (divMsg && divMsg.indexOf("하락") !== -1 && (rsiD > 75 || rsiW > 75)) add("risk", -1, "과열권 + 하락 다이버전스");
  if (isVolExhausted && divMsg && divMsg.indexOf("상승") !== -1) add("risk", 1, "팔 사람이 줄어드는 중(매도 거래량 소진)");

  var score = 0, plusAll = [], minusAll = [];
  ["trend", "mom", "risk"].forEach(function (k) {
    var g = G[k], s = cap(g.sum, g.lim);
    score += s;
    g.plus.forEach(function (t) { plusAll.push(t); });
    g.minus.forEach(function (t) { minusAll.push(t); });
  });

  // 과매도 반등 후보 (점수와 별개로 알려줌)
  var oversold = (currStoch <= 20 || rsiW <= 35 || rsiD <= 30) && dist < -0.05;
  var bounceNote = oversold ? "\n🌱 많이 떨어진 과매도 구간이에요. 점수가 낮아도 반등 후보일 수 있어요 (저점매수 ☘️ 신호와 함께 보세요)." : "";

  var summary = score >= 6 ? "🔥 지표 대부분이 상승 쪽이에요 (" + (score >= 0 ? "+" : "") + score + "점). 보유 중이면 유지, 새로 사는 것도 검토할 만해요."
              : score >= 2 ? "🎯 상승 쪽이 우세해요 (+" + score + "점). 한꺼번에 말고 나눠서 사는 걸 고려할 만해요."
              : score >= -2 ? "😐 방향이 뚜렷하지 않아요 (" + (score >= 0 ? "+" : "") + score + "점). 새로 사기엔 이르고, 보유 중이면 20일선·손절 참고선만 지켜보세요."
              : "🚨 하락 쪽이 우세해요 (" + score + "점). 새로 사는 건 서두르지 말고, 보유 중이면 손절 참고선을 확인하세요.";
  summary += bounceNote;

  var board = "📋 [AI 지표 스코어보드]\n종합 점수: " + (score >= 0 ? "+" : "") + score + "점\n\n";
  board += "🟢 가점 요인 (+):\n" + (plusAll.length ? "• " + plusAll.join("\n• ") : "• 없음") + "\n\n";
  board += "🔴 감점 요인 (-):\n" + (minusAll.length ? "• " + minusAll.join("\n• ") : "• 없음") + "\n";
  return {text: "💡 [AI 전략 요약]\n" + summary + "\n\n" + board, score: score, summary: summary};
}