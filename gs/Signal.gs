// ==========================================================
// Signal.gs - 봇 상태 / 종목 성격 분류 / 횡보장 경고 / 저점매수 강약
// Code.gs, Analysis.gs, PreMarket.gs가 이 파일의 함수를 불러 씁니다.
// ==========================================================

// 레버리지·인버스 ETF는 무조건 고변동형으로 취급
var LEVERAGED_ETFS = {
  SOXL:1, SOXS:1, TQQQ:1, SQQQ:1, UPRO:1, SPXL:1, SPXS:1, SPXU:1, TECL:1, TECS:1, FNGU:1, FNGD:1,
  LABU:1, LABD:1, TNA:1, TZA:1, FAS:1, FAZ:1, UDOW:1, SDOW:1, YINN:1, YANG:1,
  NVDL:1, NVDU:1, TSLL:1, TSLQ:1, TSLS:1, CONL:1, MSTU:1, MSTX:1, AMDL:1, GGLL:1,
  AAPU:1, MSFU:1, AMZU:1, BITX:1, BITU:1, ETHU:1, UVXY:1, SVXY:1
};

// ---------- 지금 봇 상태 (마지막 매수/매도 신호가 진행중인지) ----------
// "10-22" → "10/22"
function _kDate(md) {
  var p = String(md).split("-");
  return p.length === 2 ? Number(p[0]) + "/" + Number(p[1]) : String(md);
}
// 봇 상태 문구 (폰 화면에서 한 줄에 들어가도록 짧게)
function _stateText(headline, days, dateMd, sigPrice, cp, notes) {
  var chg = (cp / sigPrice - 1) * 100;
  var chgTxt = (chg >= 0 ? "+" : "") + chg.toFixed(1) + "%";
  var t = headline + "\n• " + (days === 0 ? "오늘 떴어요" : days + "일 전(" + _kDate(dateMd) + ") 떴어요");
  t += "\n• " + sigPrice.toFixed(2) + "$ → 지금 " + cp.toFixed(2) + "$ (" + chgTxt + ")";
  if (days > 60) t += "\n• 오래된 신호";
  (notes || []).forEach(function (n) { t += "\n• " + n; });
  return t;
}

// ---------- 공통: 일반 매수·매도 신호 ----------
// 매수 = 하이킨아시가 음봉→양봉으로 바뀐 날 + 종가가 20일선 위.  매도 = 양봉→음봉으로 바뀐 날 + 종가가 20일선 아래.
// (2026-11: "조건이 새로 맞는 날" 방식도 시험했지만, 실제 5년 시세 48종목 비교에서 이 방식이 수익률이 더 높아 되돌림.
//  비교 스크립트: tools/compare_signals.py)
function haSignalFlags(dData, haDaily) {
  var c = dData.closes, n = c.length, buyEv = [], sellEv = [], buy = [], sell = [], sum = 0, holding = false;
  for (var k = 0; k < n; k++) {
    sum += c[k]; if (k >= 20) sum -= c[k - 20];
    var ma = k >= 19 ? sum / 20 : null;
    var g = haDaily.closes[k] > haDaily.opens[k];
    var pg = k > 0 ? haDaily.closes[k - 1] > haDaily.opens[k - 1] : false;
    var be = ma !== null && k > 0 && g && !pg && c[k] > ma, se = ma !== null && k > 0 && !g && pg && c[k] < ma;
    buyEv.push(be); sellEv.push(se);
    var b = !holding && be, s2 = holding && se;
    if (b) holding = true; else if (s2) holding = false;
    buy.push(b); sell.push(s2);
  }
  return {buyEv: buyEv, sellEv: sellEv, buy: buy, sell: sell, holding: holding};
}

function getSignalState(dData, haDaily) {
  var len = dData.closes.length;
  var lastType = null, lastIdx = -1;
  var fl = haSignalFlags(dData, haDaily);
  for (var j = 0; j < len; j++) {
    if (fl.buy[j]) { lastType = "buy"; lastIdx = j; }
    else if (fl.sell[j]) { lastType = "sell"; lastIdx = j; }
  }
  // ☘️ 저점매수(클로버) 신호도 함께 반영
  var cloverIdx = -1;
  try {
    var cl = getCloverMarkersInView(dData, haDaily, 0, len);
    for (var q = len - 1; q >= 0; q--) { if (cl[q]) { cloverIdx = q; break; } }
  } catch (e) { cloverIdx = -1; }
  if (!lastType && cloverIdx < 0) return null;

  var cp = dData.closes[len - 1];
  var CLOVER_HEAD = "☘️ 저점매수 신호 (반등 시작)";

  // 일반 매수·매도 신호가 한 번도 없었고 저점매수만 있었던 경우
  if (!lastType) {
    var d0 = len - 1 - cloverIdx;
    return {type: "clover", days: d0, short: "☘️ 저점매수 " + (d0 === 0 ? "오늘" : d0 + "일 전"),
            text: _stateText(CLOVER_HEAD, d0, dData.dates[cloverIdx], dData.closes[cloverIdx], cp, ["일반 신호는 아직 없어요"])};
  }

  // 마지막 일반 신호가 '매도'인데 그 뒤에 저점매수가 떴다면 → 저점매수 상태
  if (lastType === "sell" && cloverIdx > lastIdx) {
    var cdays = len - 1 - cloverIdx;
    var cchg = (cp / dData.closes[cloverIdx] - 1) * 100;
    var sdays = len - 1 - lastIdx;
    return {
      type: "clover", days: cdays,
      short: "☘️ 저점매수 " + (cdays === 0 ? "오늘" : cdays + "일째") + " (" + (cchg >= 0 ? "+" : "") + cchg.toFixed(1) + "%)",
      text: _stateText(CLOVER_HEAD, cdays, dData.dates[cloverIdx], dData.closes[cloverIdx], cp,
                       ["일반 신호: " + sdays + "일 전 매도 후 없음"])
    };
  }

  var days = len - 1 - lastIdx;
  var sigPrice = dData.closes[lastIdx];
  var chg = (cp / sigPrice - 1) * 100;
  var chgTxt = (chg >= 0 ? "+" : "") + chg.toFixed(1) + "%";
  var notes = [];
  if (lastType === "sell") notes.push("새 매수 신호는 아직 없어요");
  else notes.push("매도 신호는 아직 없어요");
  if (lastType === "buy" && cloverIdx >= lastIdx && len - 1 - cloverIdx <= 20) {
    var cd = len - 1 - cloverIdx;
    notes.push("☘️ 저점매수도 " + (cd === 0 ? "오늘" : cd + "일 전") + " 떴어요");
  }
  return {
    type: lastType,
    days: days,
    short: (lastType === "buy" ? "🟢 매수 진행중 " : "🔴 매도 진행중 ") + (days === 0 ? "오늘" : days + "일째") + " (" + chgTxt + ")",
    text: _stateText(lastType === "buy" ? "🟢 마지막 신호: 매수" : "🔴 마지막 신호: 매도", days, dData.dates[lastIdx], sigPrice, cp, notes)
  };
}

// ---------- ADX (추세 강도) ----------
function calcADX(highs, lows, closes, period) {
  var n = closes.length;
  if (n < period * 2 + 1) return null;
  var tr = [], pdm = [], mdm = [];
  for (var i = 1; i < n; i++) {
    var up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  var sTR = 0, sP = 0, sM = 0;
  for (var k = 0; k < period; k++) { sTR += tr[k]; sP += pdm[k]; sM += mdm[k]; }
  var dxs = [];
  for (var j = period; j <= tr.length; j++) {
    if (j > period) {
      sTR = sTR - sTR / period + tr[j - 1];
      sP = sP - sP / period + pdm[j - 1];
      sM = sM - sM / period + mdm[j - 1];
    }
    var pdi = 100 * sP / sTR, mdi = 100 * sM / sTR;
    dxs.push(100 * Math.abs(pdi - mdi) / ((pdi + mdi) || 1));
  }
  if (dxs.length < period) return null;
  var adx = 0;
  for (var a = 0; a < period; a++) adx += dxs[a];
  adx /= period;
  for (var b = period; b < dxs.length; b++) adx = (adx * (period - 1) + dxs[b]) / period;
  return adx;
}

// 하루 평균 변동폭(%) - 최근 60일 평균 True Range / 종가
function calcAtrPct(dData, days) {
  var n = dData.closes.length, from = Math.max(1, n - days), sum = 0, cnt = 0;
  for (var i = from; i < n; i++) {
    var tr = Math.max(dData.highs[i] - dData.lows[i],
                      Math.abs(dData.highs[i] - dData.closes[i - 1]),
                      Math.abs(dData.lows[i] - dData.closes[i - 1]));
    sum += tr / dData.closes[i];
    cnt++;
  }
  return cnt ? sum / cnt * 100 : 0;
}

// ---------- 종목 성격 분류 ----------
function classifySymbol(symbol, atrPct) {
  var lev = !!LEVERAGED_ETFS[String(symbol).toUpperCase()];
  if (lev || atrPct >= 4) {
    return {name: lev ? "고변동형(레버리지)" : "고변동형", slopeThr: 2.5, cloverRsi: 25, cloverBb: 2.5, stopPct: 20};
  }
  if (atrPct >= 2) {
    return {name: "보통형", slopeThr: 1.5, cloverRsi: 30, cloverBb: 2, stopPct: 12};
  }
  return {name: "안정형", slopeThr: 1, cloverRsi: 30, cloverBb: 2, stopPct: 8};
}

// 클래스 기준으로 "초저점"이 최근 5일 안에 있었는지
function hadExtremeLowByClass(dData, cls) {
  var closes = dData.closes, lows = dData.lows, len = closes.length;
  var rsiFull = calculateWilderRSI(closes, 14);
  var off = len - rsiFull.length;
  var bbLow = calculateBollingerLowerArray(closes, 20, cls.cloverBb);
  for (var i = Math.max(0, len - 5); i < len; i++) {
    var ri = i - off;
    var rsi = (ri >= 0 && ri < rsiFull.length) ? rsiFull[ri] : null;
    if (rsi !== null && bbLow[i] !== null && lows[i] <= bbLow[i] && rsi <= cls.cloverRsi) return true;
  }
  return false;
}

// ---------- 종합: 성격 + 횡보 여부 + 저점매수 강약 ----------
function getSignalContext(dData, wData, haDaily, haWeekly, symbol) {
  var closes = dData.closes, highs = dData.highs, lows = dData.lows, len = closes.length;
  var atrPct = calcAtrPct(dData, 60);
  var cls = classifySymbol(symbol, atrPct);

  // 횡보 판정: 아래 3개 중 2개 이상
  var why = [];
  var adx = calcADX(highs, lows, closes, 14);
  if (adx !== null && adx < 20) why.push("ADX " + adx.toFixed(0) + " (추세 약함)");

  var maNow = calculateMA(closes, 20);
  var maPrev = len >= 26 ? calculateMA(closes.slice(0, len - 5), 20) : 0;
  var slope = maPrev > 0 ? (maNow / maPrev - 1) * 100 : null;
  if (slope !== null && Math.abs(slope) < cls.slopeThr) why.push("20일선 기울기 " + (slope >= 0 ? "+" : "") + slope.toFixed(1) + "% (평평)");

  var crosses = 0;
  if (len >= 40) {
    var prevSide = null;
    for (var i = len - 20; i < len; i++) {
      var ma = calculateMA(closes.slice(0, i + 1), 20);
      var side = closes[i] > ma;
      if (prevSide !== null && side !== prevSide) crosses++;
      prevSide = side;
    }
    if (crosses >= 3) why.push("20일선 " + crosses + "번 교차");
  }
  var sideways = why.length >= 2;

  // 저점매수 강약 판정
  var reasons = [];
  var A = len >= 2 && closes[len - 1] > highs[len - 2];
  if (!A) reasons.push("전일 고가 못 넘김");
  var macd = calculateMACDOscillator(closes);
  var B = macd.length >= 2 && macd[macd.length - 1] > macd[macd.length - 2];
  if (!B) reasons.push("MACD 아직 하락");
  var C = hadExtremeLowByClass(dData, cls);
  if (!C) reasons.push("기준 미달(RSI " + cls.cloverRsi + "·볼린저 " + cls.cloverBb + "배)");
  var drop5 = len >= 6 ? (closes[len - 1] / closes[len - 6] - 1) * 100 : 0;
  var dropThr = Math.min(Math.max(atrPct * 3.5, 8), 30);
  if (drop5 <= -dropThr) reasons.push("낙폭 가속 " + drop5.toFixed(0) + "%");

  var hl = haWeekly.closes.length - 1;
  var weeklyRed = hl >= 0 && haWeekly.closes[hl] <= haWeekly.opens[hl];

  // 오늘 저점매수(클로버) 신호가 떠 있는지 (Code.gs와 같은 기준)
  var cloverToday = false;
  var exArr = calculateIsExtremeLowArray(dData);
  var hadEx = false;
  for (var q = Math.max(0, len - 5); q < len; q++) { if (exArr[q]) { hadEx = true; break; } }
  if (hadEx && haDaily.closes.length >= 2) {
    var hd = haDaily.closes.length;
    cloverToday = haDaily.closes[hd - 1] > haDaily.opens[hd - 1] && haDaily.closes[hd - 2] <= haDaily.opens[hd - 2];
  }
  var cloverLine = "";
  if (cloverToday) {
    cloverLine = "☘️ 저점매수 신호 발생 중: " +
      (reasons.length === 0 ? "(강)" + (weeklyRed ? " ※ 주봉은 아직 음봉" : "") : "(약·주의: " + reasons.join(", ") + ")") + "\n";
  }

  var text = "\n🧭 [종목 성격 / 시장 상태]\n" + cloverLine +
    "성격: " + cls.name + " (하루 평균 변동 " + atrPct.toFixed(1) + "%, 손절 참고 평단 -" + cls.stopPct + "%)\n" +
    "상태: " + (sideways ? "⚠️ 횡보장 - " + why.join(", ") : "추세장" + (adx !== null ? " (ADX " + adx.toFixed(0) + ")" : "")) + "\n";

  return {
    cls: cls, atrPct: atrPct, adx: adx, sideways: sideways, sidewaysWhy: why,
    clover: {strong: reasons.length === 0, reasons: reasons},
    weeklyRed: weeklyRed, text: text
  };
}

// 신호 문구에 횡보 경고 / 저점매수 강약 / 종목 성격 줄을 붙임 (신호가 있을 때만)
function decorateAlerts(alerts, ctx) {
  if (!alerts || !alerts.length || !ctx) return alerts;
  var out = alerts.map(function (a) {
    if (a.indexOf("저점매수") !== -1) {
      return ctx.clover.strong
        ? "☘️ 저점매수 신호 (강)" + (ctx.weeklyRed ? " ※ 주봉은 아직 음봉" : "")
        : "☘️ 저점매수 신호 (약·주의: " + ctx.clover.reasons.join(", ") + ")";
    }
    if ((a.indexOf("추가 매수 타점") !== -1 || a.indexOf("일반 매도 타점") !== -1) && ctx.sideways) {
      return a + " ⚠️ 횡보장(신뢰 낮음)";
    }
    return a;
  });
  out.push("ℹ️ " + ctx.cls.name + " (하루 평균 변동 " + ctx.atrPct.toFixed(1) + "%)" + (ctx.sideways ? " · 횡보장" : ""));
  return out;
}