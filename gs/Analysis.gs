// ==========================================================
// Analysis.gs - 종목 분석(텍스트+차트) / 포트폴리오 표
// Code.gs의 공용 함수를 사용: processYahooData, calculateMA, calculateHeikinAshi_GAS,
// calculateWilderRSI, calculateBollingerUpperArray, calculateIsExtremeLowArray,
// checkHighpointSellSignal, isRegistered, getHoldingsSheet
// ==========================================================

function analyzeForWeb(token, ticker) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  ticker = String(ticker || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(ticker)) return {ok: false, msg: "티커 형식이 올바르지 않아요"};
  try {
    var st = "default";
    try { st = getStrategies(token).map[ticker] || "default"; } catch (e) {}
    return analyzeStock(ticker, false, st);
  } catch (e) {
    return {ok: false, msg: ticker + " 분석 중 오류: " + e.message};
  }
}

// 포트폴리오 표: 내 보유 종목 전체의 현재가/수익률/점수/추매구간/추세
function portfolioForWeb(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var sh = getHoldingsSheet();
  var last = sh.getLastRow();
  if (last < 2) return {ok: true, rows: [], avgPnl: null};

  var mine = sh.getRange(2, 1, last - 1, 3).getValues()
    .filter(function (r) { return r[0] === token && r[1]; });

  var rows = [], pnlSum = 0, pnlCount = 0;
  mine.forEach(function (r) {
    var symbol = r[1], avg = Number(r[2]) || null;
    try {
      var a = analyzeStock(symbol, true, (getStrategies(token).map[symbol] || "default"));
      if (!a.ok) { rows.push({symbol: symbol, error: true}); return; }
      var m = a.meta;
      var pnl = avg ? (m.price / avg - 1) * 100 : null;
      if (pnl !== null) { pnlSum += pnl; pnlCount++; }
      rows.push({symbol: symbol, price: m.price, avgPrice: avg, pnl: pnl, score: m.score, buyZone: m.buyZone, trendUp: m.trendUp, state: m.state, ctx: m.ctx});
    } catch (e) {
      rows.push({symbol: symbol, error: true});
    }
  });
  return {ok: true, rows: rows, avgPnl: pnlCount ? pnlSum / pnlCount : null};
}

// ---------- 지표 ----------
function calculateBollingerUpper(closes, period, multiplier) {
  if (closes.length < period) return null;
  var ma = calculateMA(closes, period);
  var slice = closes.slice(-period);
  var variance = slice.reduce(function (s, v) { return s + Math.pow(v - ma, 2); }, 0) / period;
  return ma + Math.sqrt(variance) * multiplier;
}

function calculateEMA_Array(data, period) {
  var ema = [];
  if (data.length === 0) return ema;
  var k = 2 / (period + 1);
  ema.push(data[0]);
  for (var i = 1; i < data.length; i++) ema.push(data[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

function calculateMACDOscillator(closes) {
  var ema12 = calculateEMA_Array(closes, 12);
  var ema26 = calculateEMA_Array(closes, 26);
  var macdLine = [];
  for (var i = 0; i < closes.length; i++) macdLine.push(ema12[i] - ema26[i]);
  var signalLine = calculateEMA_Array(macdLine, 9);
  var osc = [];
  for (var j = 0; j < closes.length; j++) osc.push(macdLine[j] - signalLine[j]);
  return osc;
}

function calculateStochasticRSI(rsiValues, period) {
  var out = [];
  for (var i = 0; i < rsiValues.length; i++) {
    if (i < period) { out.push(50); continue; }
    var slice = rsiValues.slice(i - period + 1, i + 1);
    var maxR = Math.max.apply(null, slice), minR = Math.min.apply(null, slice);
    out.push(((rsiValues[i] - minR) / (maxR - minR + 1e-9)) * 100);
  }
  return out;
}

// ---------- 다이버전스 ----------
function detectDivergenceFinal(data, rsi) {
  var lows = data.lows, highs = data.highs, volumes = data.volumes, len = rsi.length;
  var dLen = lows.length, offset = dLen - len;
  var startI = Math.max(0, len - 150);

  var valleys = [], peaks = [], inLow = false, curValley = null, inHigh = false, curPeak = null;
  for (var i = startI; i < len; i++) {
    var pIdx = i + offset;
    if (pIdx < 0) continue;
    var r = rsi[i];
    if (r < 35) {
      if (!inLow) { inLow = true; curValley = {idx: pIdx, rsi: r, price: lows[pIdx], vol: volumes[pIdx]}; }
      else if (r < curValley.rsi) curValley = {idx: pIdx, rsi: r, price: lows[pIdx], vol: volumes[pIdx]};
    } else if (inLow && curValley) { valleys.push(curValley); inLow = false; }
    if (r > 65) {
      if (!inHigh) { inHigh = true; curPeak = {idx: pIdx, rsi: r, price: highs[pIdx], vol: volumes[pIdx]}; }
      else if (r > curPeak.rsi) curPeak = {idx: pIdx, rsi: r, price: highs[pIdx], vol: volumes[pIdx]};
    } else if (inHigh && curPeak) { peaks.push(curPeak); inHigh = false; }
  }

  var bull = null, bear = null;
  if (valleys.length >= 2) {
    var v1 = valleys[valleys.length - 2], v2 = valleys[valleys.length - 1];
    if (v2.price < v1.price && v2.rsi > v1.rsi) bull = {msg: "일반 상승 다이버전스", pivotIndex: v2.idx};
  }
  if (peaks.length >= 2) {
    var p1 = peaks[peaks.length - 2], p2 = peaks[peaks.length - 1];
    if (p2.price > p1.price && p2.rsi < p1.rsi) bear = {msg: "일반 하락 다이버전스", pivotIndex: p2.idx};
  }
  if (bull && bear) return bull.pivotIndex >= bear.pivotIndex ? bull : bear;
  return bull || bear || {msg: "", pivotIndex: null};
}

// ---------- 추세선 ----------
function getPivots_TM(data, l, r, isHigh) {
  var pivots = [], len = data.length;
  if (len < l + r + 1) return [];
  for (var i = len - 1 - r; i >= l; i--) {
    var isP = true, val = data[i];
    for (var j = 1; j <= l; j++) { if (isHigh ? data[i - j] > val : data[i - j] < val) { isP = false; break; } }
    if (isP) { for (var k = 1; k <= r; k++) { if (isHigh ? data[i + k] >= val : data[i + k] < val) { isP = false; break; } } }
    if (isP) pivots.push({idx: i, val: val});
  }
  return pivots;
}

function getPivotsWithFallback(data, l, r, isHigh) {
  var pivots = getPivots_TM(data, l, r, isHigh);
  if (pivots.length >= 2) return pivots;
  var n = data.length;
  if (n < 10) return pivots;
  var half = Math.floor(n / 2);
  var recentIdx = -1, recentVal = null, olderIdx = -1, olderVal = null;
  for (var i = half; i < n; i++) {
    if (recentVal === null || (isHigh ? data[i] > recentVal : data[i] < recentVal)) { recentVal = data[i]; recentIdx = i; }
  }
  for (var j = 0; j < half; j++) {
    if (olderVal === null || (isHigh ? data[j] > olderVal : data[j] < olderVal)) { olderVal = data[j]; olderIdx = j; }
  }
  if (recentIdx === -1 || olderIdx === -1 || recentIdx === olderIdx) return pivots;
  return [{idx: recentIdx, val: recentVal}, {idx: olderIdx, val: olderVal}];
}

function calcResLine_TM(pivots, currentIdx) {
  if (pivots.length < 2) return null;
  var p1 = pivots[0], p2 = null;
  for (var i = 1; i < pivots.length; i++) { if (pivots[i].val > p1.val) { p2 = pivots[i]; break; } }
  if (!p2) p2 = pivots[1];
  var slope = (p1.val - p2.val) / (p1.idx - p2.idx);
  return p1.val + slope * (currentIdx - 1 - p1.idx);
}

function calcSupLine_TM(pivots, currentIdx) {
  if (pivots.length < 2) return null;
  var p1 = pivots[0], p2 = null;
  for (var i = 1; i < pivots.length; i++) { if (pivots[i].val < p1.val) { p2 = pivots[i]; break; } }
  if (!p2) p2 = pivots[1];
  var slope = (p1.val - p2.val) / (p1.idx - p2.idx);
  return p1.val + slope * (currentIdx - 1 - p1.idx);
}

function isGenuineResistance(pivots) {
  if (!pivots || pivots.length < 2) return false;
  for (var i = 1; i < pivots.length; i++) if (pivots[i].val > pivots[0].val) return true;
  return false;
}

function isGenuineResistanceWithRecentPeak(pivots, recentHighs, currentPrice) {
  if (isGenuineResistance(pivots)) return true;
  if (!recentHighs || !recentHighs.length || !currentPrice) return false;
  return Math.max.apply(null, recentHighs) > currentPrice * 1.15;
}

function isGenuineSupport(pivots) {
  if (!pivots || pivots.length < 2) return false;
  for (var i = 1; i < pivots.length; i++) if (pivots[i].val < pivots[0].val) return true;
  return false;
}

function calcTrendLineArray(pivots, viewStartIdx, viewLen, isResistance, priceHighs, priceLows) {
  if (!pivots || pivots.length < 2) return null;
  var p1 = pivots[0], p2 = null;
  for (var i = 1; i < pivots.length; i++) {
    if (isResistance ? pivots[i].val > p1.val : pivots[i].val < p1.val) { p2 = pivots[i]; break; }
  }
  if (!p2) p2 = pivots[1];
  var slope = (p1.val - p2.val) / (p1.idx - p2.idx);
  var lineStartIdx = Math.min(p1.idx, p2.idx);
  var arr = [], broken = false;
  for (var x = viewStartIdx; x < viewStartIdx + viewLen; x++) {
    if (x < lineStartIdx || broken) { arr.push(null); continue; }
    var lineVal = p1.val + slope * (x - p1.idx);
    var ci = x - viewStartIdx;
    if (isResistance && priceHighs && priceHighs[ci] > lineVal) broken = true;
    else if (!isResistance && priceLows && priceLows[ci] < lineVal) broken = true;
    arr.push(lineVal);
  }
  return arr;
}

// ---------- 차트 마커 ----------
function getHighpointSellMarkersInView(dData, wData, haDaily, viewStartIdx, viewLen) {
  var result = new Array(viewLen).fill(false);
  var wCloses = wData.closes, wHighs = wData.highs, wDates = wData.dates, wLen = wCloses.length;
  if (wLen < 25) return result;
  var wRsiFull = calculateWilderRSI(wCloses, 14);
  var wBb = calculateBollingerUpperArray(wCloses, 20, 2);
  var rsiOffset = wLen - wRsiFull.length;
  var isExtremeHigh = [];
  for (var i = 0; i < wLen; i++) {
    var ri = i - rsiOffset;
    var rsi = (ri >= 0 && ri < wRsiFull.length) ? wRsiFull[ri] : null;
    isExtremeHigh.push(rsi !== null && wBb[i] !== null && wHighs[i] >= wBb[i] && rsi >= 70);
  }
  var isEdge = [];
  for (var e = 0; e < wLen; e++) isEdge.push(e > 0 ? (isExtremeHigh[e] && !isExtremeHigh[e - 1]) : isExtremeHigh[e]);

  var wIdx = -1;
  for (var x = viewStartIdx; x < viewStartIdx + viewLen; x++) {
    var dDate = dData.dates[x];
    while (wIdx + 1 < wLen && wDates[wIdx + 1] <= dDate) wIdx++;
    var recentEdge = false;
    if (wIdx >= 0) {
      for (var k = Math.max(0, wIdx - 1); k <= wIdx; k++) if (isEdge[k]) { recentEdge = true; break; }
    }
    var turnedBear = false;
    if (x >= 1) turnedBear = haDaily.closes[x] <= haDaily.opens[x] && haDaily.closes[x - 1] > haDaily.opens[x - 1];
    result[x - viewStartIdx] = recentEdge && turnedBear;
  }
  return result;
}

function getVolumeSurgeMarkersInView(dData, haDaily, viewStartIdx, viewLen) {
  var result = new Array(viewLen).fill(null);
  for (var x = viewStartIdx; x < viewStartIdx + viewLen; x++) {
    if (x < 20) continue;
    var volMA20 = calculateMA(dData.volumes.slice(x - 20, x), 20);
    if (volMA20 <= 0 || dData.volumes[x] / volMA20 < 1.5) continue;
    result[x - viewStartIdx] = haDaily.closes[x] > haDaily.opens[x] ? 'up' : 'down';
  }
  return result;
}

function getCloverMarkersInView(dData, haDaily, viewStartIdx, viewLen) {
  var isExtremeLow = calculateIsExtremeLowArray(dData);
  var result = new Array(viewLen).fill(false);
  for (var x = viewStartIdx; x < viewStartIdx + viewLen; x++) {
    var hadRecent = false;
    for (var k = Math.max(0, x - 4); k <= x; k++) if (isExtremeLow[k]) { hadRecent = true; break; }
    var turnedGreen = x >= 1 && haDaily.closes[x] > haDaily.opens[x] && haDaily.closes[x - 1] <= haDaily.opens[x - 1];
    result[x - viewStartIdx] = hadRecent && turnedGreen;
  }
  return result;
}

// ---------- 점수 ----------
function getWeeklyTrendScore(cp, haWeekly, currRsiW, longStopPrice, isHighpointSell) {
  var score = 0, items = [];
  var n = haWeekly.closes.length;
  var curBull = n > 0 && haWeekly.closes[n - 1] > haWeekly.opens[n - 1];
  var prevBull = n > 1 && haWeekly.closes[n - 2] > haWeekly.opens[n - 2];
  var streak = 0;
  for (var i = n - 1; i >= 0; i--) {
    if ((haWeekly.closes[i] > haWeekly.opens[i]) === curBull) streak++; else break;
  }
  if (curBull && prevBull) { score += 4; items.push("주봉 " + streak + "주 연속 양봉 (대세 상승) (+4)"); }
  else if (curBull) { score += 2; items.push("주봉 양봉 전환 (+2)"); }
  else if (streak >= 2) { score -= 3; items.push("주봉 " + streak + "주 연속 음봉 (대세 하락) (-3)"); }
  else { score -= 1; items.push("주봉 음봉 (-1)"); }

  if (currRsiW >= 70) { score -= 1; items.push("주봉 RSI 과매수권 (-1)"); }
  else if (currRsiW <= 30) { score += 1; items.push("주봉 RSI 과매도권 (+1)"); }

  if (longStopPrice) {
    if (cp > longStopPrice) { score += 1; items.push("장기 지지선 위 유지 (+1)"); }
    else { score -= 2; items.push("장기 지지선 이탈 (-2)"); }
  }
  if (isHighpointSell) { score -= 3; items.push("🌋 주봉 과열 후 반전 확정 (-3)"); }

  var summary = score >= 5 ? "🔥 중장기 추세 매우 강함" : score >= 2 ? "📈 중장기 추세 양호"
              : score >= -2 ? "😐 중장기 추세 방향성 불명확" : "📉 중장기 추세 약화";
  return {score: score, items: items, summary: summary};
}

function getAiVerdict2(cp, ma20, rsiD, rsiW, divMsg, isHooked, isVolExhausted, haDaily, haWeekly, shortStop, longStop, currMacd, prevMacd, prev2Macd, currStoch, prevStoch, bbUpper, isHighpointSell, isVolumeSurge, isDailyBullForVol) {
  var score = 0, plus = [], minus = [];
  var hD = haDaily.closes.length, hW = haWeekly.closes.length;
  var dailyBull = hD > 0 && haDaily.closes[hD - 1] > haDaily.opens[hD - 1];
  var weeklyBull = hW > 0 && haWeekly.closes[hW - 1] > haWeekly.opens[hW - 1];
  var weeklyBullPrev = hW > 1 && haWeekly.closes[hW - 2] > haWeekly.opens[hW - 2];
  var dist = (cp - ma20) / ma20;
  var streak = 0;
  if (weeklyBull) { for (var wi = hW - 1; wi >= 0; wi--) { if (haWeekly.closes[wi] > haWeekly.opens[wi]) streak++; else break; } }

  if (cp > ma20) { score += 1; plus.push("현재가 > 20일선 (+1)"); } else { score -= 1; minus.push("현재가 < 20일선 (-1)"); }
  if (dailyBull) { score += 2; plus.push("일봉 하이킨 양봉 (단기 상승) (+2)"); } else { score -= 2; minus.push("일봉 하이킨 음봉 (단기 하락) (-2)"); }
  if (weeklyBull && weeklyBullPrev) { score += 4; plus.push("주봉 " + streak + "주 연속 양봉 (대세 상승) (+4)"); }
  else if (weeklyBull) { score += 2; plus.push("주봉 첫 양봉 전환 (+2)"); }
  else { score -= 3; minus.push("주봉 하락 정체 (-3)"); }

  if (currStoch >= 80) { score += 1; plus.push("스토치RSI 과매수권 진입 (강한 상승 추세) (+1)"); }
  else if (currStoch <= 20) { score -= 1; minus.push("스토치RSI 과매도권 진입 (-1)"); }
  else if (prevStoch <= 20 && currStoch > 20) { score += 1; plus.push("스토치RSI 바닥 탈출 (턴어라운드) (+1)"); }
  else if (prevStoch >= 80 && currStoch < 80) { score -= 1; minus.push("스토치RSI 상승 모멘텀 둔화 (-1)"); }

  if (prevMacd > 0 && currMacd <= 0) { score -= 3; minus.push("MACD 데드크로스 (-3)"); }
  else if (prevMacd < 0 && currMacd >= 0) { score += 3; plus.push("MACD 골든크로스 환호 (+3)"); }
  else if (prevMacd > 0 && currMacd > 0 && currMacd < prevMacd) { score -= 1; minus.push("MACD 상승 탄력 둔화 (-1)"); }
  else if (prevMacd < 0 && currMacd < 0 && currMacd > prevMacd) { score += 1; plus.push("MACD 하락 압력 회복세 (+1)"); }

  if (dist >= 0 && dist < 0.03) { score += 1; plus.push("이평선 근접 지지 영역 (+1)"); }
  if (bbUpper && cp >= bbUpper) { score += 1; plus.push("볼린저 상단 돌파 (모멘텀 폭발) (+1)"); }
  if (shortStop && cp < shortStop && !dailyBull) { score -= 1; minus.push("단기 전환점 이탈 (-1)"); }
  if (longStop && cp < longStop && !weeklyBull) { score -= 2; minus.push("장기 지지선 이탈 (-2)"); }
  else if (longStop && cp <= longStop * 1.03 && cp >= longStop) { score += 1; plus.push("장기 지지선 근접 손익비 우수 (+1)"); }

  if (isHighpointSell) { score -= 4; minus.push("🌋 주봉 과열 후 반전 확정 (-4)"); }
  if (isVolumeSurge) {
    if (isDailyBullForVol) { score += 2; plus.push("📊 거래량 급증 동반 상승 (+2)"); }
    else { score -= 2; minus.push("📊 거래량 급증 동반 하락 (-2)"); }
  }
  if (divMsg && isHooked) {
    if (divMsg.indexOf("상승") !== -1) { score += 2; plus.push("상승 다이버전스 확증 (+2)"); }
    else { score -= 2; minus.push("하락 다이버전스 확증 경고 (-2)"); }
  }
  if (divMsg && divMsg.indexOf("하락") !== -1 && (rsiD > 75 || rsiW > 75)) { score -= 1; minus.push("과매수권 하락 다이버전스 상투 위험 (-1)"); }
  if (isVolExhausted && divMsg && divMsg.indexOf("상승") !== -1) { score += 1; plus.push("매도 거래량 소진 (+1)"); }

  var summary = score >= 7 ? "🔥 지표 대부분이 상승 쪽이에요 (점수 +7 이상). 보유 중이면 유지하고, 새로 사는 것도 검토할 만해요."
              : score >= 3 ? "🎯 상승 쪽이 우세해요 (점수 +3 ~ +6). 한꺼번에 말고 나눠서 사는 걸 고려할 만한 구간이에요."
              : score >= -3 ? "😐 방향이 뚜렷하지 않아요 (점수 -3 ~ +2). 새로 사기엔 이르고, 보유 중이면 20일선·손절 참고선을 지키는지만 보세요."
              : "🚨 하락 쪽이 우세해요 (점수 -4 이하). 새로 사는 건 피하고, 보유 중이면 손절 참고선을 확인하세요.";
  summary += "\n※ 이 점수는 지표를 종합한 참고용이에요. 위 '봇 상태'(사고파는 신호)와는 별개예요.";

  var board = "📋 [AI 지표 스코어보드]\n종합 점수: " + (score >= 0 ? "+" : "") + score + "점\n\n";
  board += "🟢 가점 요인 (+):\n" + (plus.length ? "• " + plus.join("\n• ") : "• 없음") + "\n\n";
  board += "🔴 감점 요인 (-):\n" + (minus.length ? "• " + minus.join("\n• ") : "• 없음") + "\n";
  return {text: "💡 [AI 전략 요약]\n" + summary + "\n\n" + board, score: score, summary: summary};
}

function countConsecutiveHA(ha) {
  var n = ha.closes.length;
  if (n === 0) return {color: null, count: 0};
  var lastBull = ha.closes[n - 1] > ha.opens[n - 1], count = 0;
  for (var i = n - 1; i >= 0; i--) {
    if ((ha.closes[i] > ha.opens[i]) === lastBull) count++; else break;
  }
  return {color: lastBull, count: count};
}

// ==========================================================
// 종목 분석 본체: 텍스트 + 차트 이미지(base64)
// skipChart=true면 차트 없이 표용 요약(meta)만 계산 (포트폴리오 표에 사용)
// ==========================================================
function analyzeStock(ticker, skipChart, stratKey) {
  var base = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker);
  var resps = UrlFetchApp.fetchAll([
    {url: base + "?range=2y&interval=1d", muteHttpExceptions: true},
    {url: base + "?range=10y&interval=1wk", muteHttpExceptions: true}
  ]);
  if (resps[0].getResponseCode() !== 200 || resps[1].getResponseCode() !== 200) {
    return {ok: false, msg: ticker + " 데이터를 찾을 수 없어요. 티커를 확인하세요."};
  }
  var dData = processYahooData(JSON.parse(resps[0].getContentText()));
  var wData = processYahooData(JSON.parse(resps[1].getContentText()));
  if (!dData || dData.closes.length < 60 || !wData) return {ok: false, msg: ticker + " 데이터 부족으로 분석 불가예요."};

  var len = dData.closes.length;
  var cp = dData.closes[len - 1], ch = dData.highs[len - 1], cl = dData.lows[len - 1];

  var ma20 = calculateMA(dData.closes, 20);
  var rsi9 = calculateWilderRSI(dData.closes, 9);
  var stochRSI = calculateStochasticRSI(rsi9, 14);
  var currRsi9 = rsi9[rsi9.length - 1];
  var currStoch = stochRSI[stochRSI.length - 1], prevStoch = stochRSI[stochRSI.length - 2];
  var currRsiW = calculateWilderRSI(wData.closes, 14).pop() || 0;
  var bbUpper = calculateBollingerUpper(dData.closes, 20, 2);

  var macdData = calculateMACDOscillator(dData.closes);
  var mLen = macdData.length;
  var currMacd = macdData[mLen - 1], prevMacd = macdData[mLen - 2], prev2Macd = macdData[mLen - 3];

  var haDaily = calculateHeikinAshi_GAS(dData);
  var haWeekly = calculateHeikinAshi_GAS(wData);
  var hLenD = haDaily.closes.length, hLenW = haWeekly.closes.length;

  var div = detectDivergenceFinal(dData, rsi9);
  var isVolExhausted = dData.volumes[len - 1] < (dData.volumes[div.pivotIndex || len - 10] * 0.95);
  var isHooked = false;
  if (div.msg.indexOf("상승") !== -1 && prevStoch <= 35 && currStoch > prevStoch) isHooked = true;
  else if (div.msg.indexOf("하락") !== -1 && prevStoch >= 65 && currStoch < prevStoch) isHooked = true;

  var sPivotsH = getPivotsWithFallback(dData.highs, 3, 3, true);
  var lPivotsH = getPivotsWithFallback(dData.highs, 15, 15, true);
  var sPivotsL = getPivotsWithFallback(dData.lows, 3, 3, false);
  var lPivotsL = getPivotsWithFallback(dData.lows, 15, 15, false);

  var shortStopPrice = null, longStopPrice = null;
  for (var i = hLenD - 1; i >= 1; i--) {
    if (haDaily.closes[i] > haDaily.opens[i] && haDaily.closes[i - 1] <= haDaily.opens[i - 1]) { shortStopPrice = haDaily.lows[i]; break; }
  }
  if (!shortStopPrice || shortStopPrice >= cp) shortStopPrice = Math.min.apply(null, dData.lows.slice(-10));
  for (var w = hLenW - 1; w >= 1; w--) {
    if (haWeekly.closes[w] > haWeekly.opens[w] && haWeekly.closes[w - 1] <= haWeekly.opens[w - 1]) { longStopPrice = haWeekly.lows[w]; break; }
  }
  if (!longStopPrice || longStopPrice >= cp) longStopPrice = Math.min.apply(null, dData.lows.slice(-40));

  var sResPrice = calcResLine_TM(sPivotsH, len), lResPrice = calcResLine_TM(lPivotsH, len);
  var sSupPrice = calcSupLine_TM(sPivotsL, len), lSupPrice = calcSupLine_TM(lPivotsL, len);

  var nearCands = [];
  if (ma20 && ma20 < cp) nearCands.push(ma20);
  if (sSupPrice && sSupPrice < cp) nearCands.push(sSupPrice);
  var entryZone1 = nearCands.length ? Math.max.apply(null, nearCands) : null;
  var entryZone2 = (lSupPrice && lSupPrice < cp && (!entryZone1 || lSupPrice < entryZone1)) ? lSupPrice : null;

  var isHighpointSell = checkHighpointSellSignal(wData, haDaily);
  var isDailyBullForVol = haDaily.closes[hLenD - 1] > haDaily.opens[hLenD - 1];
  var volMA20 = calculateMA(dData.volumes.slice(0, len - 1), 20);
  var volRatio = volMA20 > 0 ? dData.volumes[len - 1] / volMA20 : 0;
  var isVolumeSurge = volMA20 > 0 && volRatio >= 1.5;

  var verdict = getAiVerdict2(cp, ma20, currRsi9, currRsiW, div.msg, isHooked, isVolExhausted, haDaily, haWeekly, shortStopPrice, longStopPrice, currMacd, prevMacd, prev2Macd, currStoch, prevStoch, bbUpper, isHighpointSell, isVolumeSurge, isDailyBullForVol);
  var weekly = getWeeklyTrendScore(cp, haWeekly, currRsiW, longStopPrice, isHighpointSell);

  // ---------- 텍스트 ----------
  var res = "🏛️ [" + ticker + " ]\n현재가: " + cp.toFixed(2) + "$\n";
  if (entryZone1 || entryZone2) {
    res += "📍 진입 후보 자리 (참고용, 매수 신호 아님)\n";
    if (entryZone1) res += "  1차: " + entryZone1.toFixed(2) + "$ (20일선/단기지지 근접)\n";
    if (entryZone2) res += "  2차: " + entryZone2.toFixed(2) + "$ (장기지지 근접, 더 깊은 조정 시)\n";
  }
  res += "\n";
  if (isHighpointSell) res += "🌋 [장기 고점 매도 신호] 주봉 과열(RSI 70+/볼린저 상단) 이후 일봉 하이킨아시 반전 확정 - 이익 실현/위험 관리 고려\n\n";
  if (isVolumeSurge) {
    res += "📊 [거래량 급증] 평균 대비 " + volRatio.toFixed(1) + "배, " + (isDailyBullForVol ? "상승 동반 - 매수세 유입 확인" : "하락 동반 - 매도 압력 확인") + "\n\n";
  }
  res += verdict.text + "\n";
  res += "📈 [중장기 추세 점수 (주봉 기준)]\n" + weekly.summary + " (" + (weekly.score >= 0 ? "+" : "") + weekly.score + "점)\n• " + weekly.items.join("\n• ") + "\n\n";

  var viewLen = Math.min(90, len);
  var chartHighs = dData.highs.slice(-viewLen);
  var chartLows = dData.lows.slice(-viewLen);
  var lResG = isGenuineResistanceWithRecentPeak(lPivotsH, chartHighs, cp);
  var sResG = isGenuineResistanceWithRecentPeak(sPivotsH, chartHighs, cp);
  var sSupG = isGenuineSupport(sPivotsL), lSupG = isGenuineSupport(lPivotsL);

  res += "\n📍 [트렌드 라인]\n";
  if (lResPrice) res += (lResG ? "장기저항: " : "장기채널상단(참고): ") + lResPrice.toFixed(2) + "$ (" + ((cp > lResPrice || ch > lResPrice) ? "🚀 돌파" : "🎯 대기") + ")\n";
  else if (lPivotsH.length === 1) res += "장기수평저항: " + lPivotsH[0].val.toFixed(2) + "$\n";
  if (sResPrice) res += (sResG ? "단기저항: " : "단기채널상단(참고): ") + sResPrice.toFixed(2) + "$ (" + ((cp > sResPrice || ch > sResPrice) ? "🔥 돌파" : "🔍 확인") + ")\n";
  if (sSupPrice) res += (sSupG ? "단기지지: " : "단기채널하단(참고): ") + sSupPrice.toFixed(2) + "$ (" + ((cp < sSupPrice || cl < sSupPrice) ? "🚨 이탈" : "✅ 유지") + ")\n";
  else if (sPivotsL.length === 1) res += "단기수평지지: " + sPivotsL[0].val.toFixed(2) + "$\n";
  if (lSupPrice) res += (lSupG ? "장기지지: " : "장기채널하단(참고): ") + lSupPrice.toFixed(2) + "$ (" + ((cp < lSupPrice || cl < lSupPrice) ? "📉 이탈" : "🛡️ 강력") + ")\n";
  else if (lPivotsL.length === 1) res += "장기수평지지: " + lPivotsL[0].val.toFixed(2) + "$\n";

  res += "\n📊 [하이킨 아시 추세]\n";
  var ds = countConsecutiveHA(haDaily), ws = countConsecutiveHA(haWeekly);
  if (ds.count > 0) res += "일봉: " + (ds.color ? "🟢 양봉" : "🔴 음봉") + " " + ds.count + "일 연속 (" + (ds.color ? "단기 상승" : "단기 하락") + ")\n";
  if (ws.count > 0) res += "주봉: " + (ws.color ? "🟢 양봉" : "🔴 음봉") + " " + ws.count + "주 연속 (" + (ws.color ? "대세 상승" : "대세 하락") + ")\n";
  if (hLenD >= 2 && haDaily.closes[hLenD - 1] > haDaily.opens[hLenD - 1] && haDaily.closes[hLenD - 2] < haDaily.opens[hLenD - 2]) {
    res += "💥 일봉 턴어라운드(발목) 발생\n";
  }

  var sigState = getSignalState(dData, haDaily);          // ① 먼저 만들고
  var stratState = getStrategyState(ticker, stratKey);    // ② 전략 상태를 구해서
  if (stratState) sigState = stratState;                  // ③ 덮어쓴 다음에
  var sigCtx = getSignalContext(dData, wData, haDaily, haWeekly, ticker);
  if (sigState) res += "\n🤖 [봇 상태] " + sigState.text + "\n";   // ④ 사용
  res += sigCtx.text;
  
  // 포트폴리오 표용 요약
  var meta = {price: cp, score: verdict.score, buyZone: entryZone1, trendUp: isDailyBullForVol, state: sigState,
              ctx: {cls: sigCtx.cls.name, atrPct: sigCtx.atrPct, stopPct: sigCtx.cls.stopPct, sideways: sigCtx.sideways}};
  if (skipChart) return {ok: true, text: res, image: null, meta: meta};

  // ---------- 차트 데이터 ----------
  var chartDates = dData.dates.slice(-viewLen), chartOpens = dData.opens.slice(-viewLen);
  var chartCloses = dData.closes.slice(-viewLen), chartVolumes = dData.volumes.slice(-viewLen);
  var localMin = Math.min.apply(null, chartLows), localMax = Math.max.apply(null, chartHighs);
  var markerOffset = (localMax - localMin) * 0.05 || chartCloses[0] * 0.02;

  var isHoldingState = false;
  var fullBuy = new Array(len).fill(false), fullSell = new Array(len).fill(false);
  for (var f = 0; f < len; f++) {
    var fMa = calculateMA(dData.closes.slice(0, f + 1), 20);
    var fGreen = haDaily.closes[f] > haDaily.opens[f];
    var fPrevRed = f > 0 ? haDaily.closes[f - 1] <= haDaily.opens[f - 1] : false;
    var fRed = haDaily.closes[f] <= haDaily.opens[f];
    var fPrevGreen = f > 0 ? haDaily.closes[f - 1] > haDaily.opens[f - 1] : false;
    var fPrice = dData.closes[f];
    if (!isHoldingState && fGreen && fPrevRed && fPrice > fMa) { fullBuy[f] = true; isHoldingState = true; }
    else if (isHoldingState && fRed && fPrevGreen && fPrice < fMa) { fullSell[f] = true; isHoldingState = false; }
  }
  applyStrategyToMarkers(dData, ticker, stratKey, fullBuy, fullSell);

  var chartMa20 = [], buyMarkers = [], sellMarkers = [];
  for (var c = len - viewLen; c < len; c++) {
    var idx = c - (len - viewLen);
    chartMa20.push(calculateMA(dData.closes.slice(0, c + 1), 20));
    buyMarkers.push(fullBuy[c] ? chartLows[idx] - markerOffset : null);
    sellMarkers.push(fullSell[c] ? chartHighs[idx] + markerOffset : null);
  }

  var viewStartIdx = len - viewLen;
  var lResArr = calcTrendLineArray(lPivotsH, viewStartIdx, viewLen, true, chartHighs, chartLows);
  var sResArr = calcTrendLineArray(sPivotsH, viewStartIdx, viewLen, true, chartHighs, chartLows);
  var sSupArr = calcTrendLineArray(sPivotsL, viewStartIdx, viewLen, false, chartHighs, chartLows);
  var lSupArr = calcTrendLineArray(lPivotsL, viewStartIdx, viewLen, false, chartHighs, chartLows);

  var image = null;
  try {
    image = buildChartImage2(ticker, chartDates, chartOpens, chartHighs, chartLows, chartCloses, chartVolumes, chartMa20,
      buyMarkers, sellMarkers, lResArr, sResArr, sSupArr, lSupArr, lResG, sResG, sSupG, lSupG,
      getHighpointSellMarkersInView(dData, wData, haDaily, viewStartIdx, viewLen),
      getVolumeSurgeMarkersInView(dData, haDaily, viewStartIdx, viewLen),
      longStopPrice, entryZone1, entryZone2, macdData.slice(-viewLen),
      getCloverMarkersInView(dData, haDaily, viewStartIdx, viewLen),
      rsi9.slice(-viewLen), stochRSI.slice(-viewLen));
      getDivergenceView(dData, rsi9, viewStartIdx, viewLen)
  } catch (e) {
    console.error("차트 생성 실패: " + e.message);
  }
  return {ok: true, text: res, image: image, meta: meta};
}

// ==========================================================
// QuickChart로 차트 이미지 생성 → base64 반환 (실패 시 null)
// ==========================================================
function buildChartImage(ticker, dates, opens, highs, lows, closes, volumes, ma20, buyMarkers, sellMarkers,
    lResArr, sResArr, sSupArr, lSupArr, lResG, sResG, sSupG, lSupG, highpointSell, volSurge,
    longStopPrice, entryZone1, entryZone2, macdValues, cloverMarkers) {

  var candle = [], ma = [], buy = [], sell = [], hp = [], clover = [], surgeUp = [], surgeDown = [];
  var vol = [], volColors = [], lRes = [], sRes = [], sSup = [], lSup = [];
  var macdBar = [], macdLine = [], macdColors = [];
  var rangeMax = Math.max.apply(null, highs), rangeMin = Math.min.apply(null, lows);
  var offset = (rangeMax - rangeMin) * 0.03 || closes[0] * 0.01;

  for (var i = 0; i < dates.length; i++) {
    candle.push({x: dates[i], o: opens[i], h: highs[i], l: lows[i], c: closes[i]});
    ma.push({x: dates[i], y: ma20[i]});
    vol.push({x: dates[i], y: volumes[i]});
    volColors.push(closes[i] >= opens[i] ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)');
    if (buyMarkers[i] !== null) buy.push({x: dates[i], y: buyMarkers[i]});
    if (sellMarkers[i] !== null) sell.push({x: dates[i], y: sellMarkers[i]});
    if (highpointSell[i]) hp.push({x: dates[i], y: highs[i] + offset * 2});
    if (cloverMarkers[i]) clover.push({x: dates[i], y: lows[i] - offset});
    if (volSurge[i] === 'up') surgeUp.push({x: dates[i], y: volumes[i] * 1.15});
    else if (volSurge[i] === 'down') surgeDown.push({x: dates[i], y: volumes[i] * 1.15});
    if (lResArr) lRes.push({x: dates[i], y: lResArr[i]});
    if (sResArr) sRes.push({x: dates[i], y: sResArr[i]});
    if (sSupArr) sSup.push({x: dates[i], y: sSupArr[i]});
    if (lSupArr) lSup.push({x: dates[i], y: lSupArr[i]});
    var mv = macdValues[i] !== undefined ? macdValues[i] : 0;
    macdBar.push({x: dates[i], y: mv});
    macdLine.push({x: dates[i], y: mv});
    macdColors.push(mv >= 0 ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)');
  }

  var priceMin = Math.min.apply(null, lows), priceMax = Math.max.apply(null, highs);
  var priceAxisMax = priceMax;
  var priceAxisMin = (priceMin - 0.35 * priceMax) / (1 - 0.35);
  var macdAbsMax = Math.max.apply(null, macdBar.map(function (d) { return Math.abs(d.y); })) || 1;
  var macdTotal = macdAbsMax / 0.08;
  var macdAxisMin = -0.24 * macdTotal, macdAxisMax = macdTotal * (1 - 0.24);
  var maxVol = Math.max.apply(null, volumes);
  var volMax = isFinite(maxVol) && maxVol > 0 ? maxVol * 8 : 100;

  var stop = [], z1 = [], z2 = [];
  for (var h = Math.max(0, dates.length - 20); h < dates.length; h++) {
    if (longStopPrice) stop.push({x: dates[h], y: longStopPrice});
    if (entryZone1) z1.push({x: dates[h], y: entryZone1});
    if (entryZone2) z2.push({x: dates[h], y: entryZone2});
  }

  function line(label, data, color, width, dash) {
    return {type: 'line', label: label, data: data, borderColor: color, borderWidth: width, borderDash: dash || [],
            fill: false, pointRadius: 0, yAxisID: 'y'};
  }
  function dot(label, data, bg, style, radius, axis, border) {
    return {type: 'scatter', label: label, data: data, backgroundColor: bg, borderColor: border || bg,
            borderWidth: border ? 2 : 1, pointStyle: style, radius: radius, yAxisID: axis || 'y'};
  }

  var chartConfig = {
    type: 'candlestick',
    data: {
      labels: dates,
      datasets: [
        {type: 'candlestick', label: '주가', data: candle, yAxisID: 'y',
         color: {up: '#26a69a', down: '#ef5350', unchanged: '#787b86'}, barPercentage: 0.35, categoryPercentage: 0.45},
        line('20일선', ma, '#f5a623', 1.5),
        line('1차 진입후보', z1, '#00bcd4', 1.8),
        line('2차 진입후보', z2, '#0091ea', 1.8, [4, 3]),
        line('장기손절가', stop, '#d50000', 2, [3, 3]),
        line(lResG ? '장기추세저항' : '장기채널상단', lRes, '#ff5252', 1.3, [6, 4]),
        line(sResG ? '단기추세저항' : '단기채널상단', sRes, '#ffb74d', 1.3, [6, 4]),
        line(sSupG ? '단기추세지지' : '단기채널하단', sSup, '#81c784', 1.3, [6, 4]),
        line(lSupG ? '장기추세지지' : '장기채널하단', lSup, '#26a69a', 1.3, [6, 4]),
        dot('매수 타점', buy, '#00e676', 'triangle', 8),
        dot('매도 타점', sell, '#ff5252', 'rectRot', 8),
        dot('고점매도', hp, '#ab47bc', 'rect', 9, 'y', '#ffffff'),
        dot('저점매수', clover, '#64dd17', 'circle', 8),
        dot('거래량급증(상승)', surgeUp, '#ffd54f', 'triangle', 6, 'y-volume'),
        dot('거래량급증(하락)', surgeDown, '#ffd54f', 'rectRot', 6, 'y-volume'),
        {type: 'bar', label: 'MACD', data: macdBar, backgroundColor: macdColors, yAxisID: 'y-macd', barPercentage: 0.35, categoryPercentage: 0.45},
        {type: 'line', label: 'MACD Line', data: macdLine, borderColor: '#f5a623', borderWidth: 1.2, fill: false, pointRadius: 0, tension: 0.2, yAxisID: 'y-macd'},
        {type: 'bar', label: '거래량', data: vol, backgroundColor: volColors, yAxisID: 'y-volume', barPercentage: 0.35, categoryPercentage: 0.45}
      ]
    },
    options: {
      plugins: {
        legend: {display: false},
        datalabels: {display: false},
        title: {display: true, text: ticker + ' AI 최근 ' + dates.length + '일 타점 차트', color: '#d1d4dc', font: {size: 16}}
      },
      scales: {
        x: {type: 'category', grid: {color: '#2b2b43'}, ticks: {color: '#787b86', maxTicksLimit: 12}},
        y: {type: 'linear', position: 'right', grid: {color: '#2b2b43'}, ticks: {color: '#787b86'}, min: priceAxisMin, max: priceAxisMax},
        'y-volume': {type: 'linear', position: 'left', display: false, min: 0, max: volMax},
        'y-macd': {type: 'linear', position: 'left', display: false, min: macdAxisMin, max: macdAxisMax}
      }
    }
  };

  var response = UrlFetchApp.fetch('https://quickchart.io/chart', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({version: '3', chart: chartConfig, width: 800, height: 500, backgroundColor: '#131722'}),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return null;
  return Utilities.base64Encode(response.getBlob().getBytes());
}

// 편집기에서 바로 테스트: 로그에 분석 텍스트와 "이미지: 생성됨"이 나오면 성공
function testAnalyze() {
  var r = analyzeStock("SNDK", false);
  Logger.log(r.ok ? r.text + "\n\n이미지: " + (r.image ? "생성됨(" + r.image.length + "자)" : "실패") : r.msg);
}