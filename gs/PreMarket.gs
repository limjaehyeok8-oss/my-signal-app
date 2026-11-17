// ==========================================================
// PreMarket.gs - 개장 직전(프리장 가격 기준) + 정규장 마감 직후, 신호 있는 종목만 알림
// 프리장 가격을 오늘의 임시 일봉으로 붙여서 매수/매도/저점 신호를 다시 계산합니다.
// Code.gs, Analysis.gs는 그대로 두고 이 파일만 새로 추가하세요.
// ==========================================================

// 프리장 현재가 가져오기: {SYMBOL: {price, ts}} (데이터 없으면 null)
function fetchPreMarket(symbols) {
  var reqs = symbols.map(function (s) {
    return {
      url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=1d&interval=5m&includePrePost=true",
      muteHttpExceptions: true
    };
  });
  var resps = UrlFetchApp.fetchAll(reqs);
  var out = {};
  resps.forEach(function (r, i) {
    out[symbols[i]] = null;
    try {
      var res = JSON.parse(r.getContentText()).chart.result[0];
      var closes = res.indicators.quote[0].close;
      var ts = res.timestamp;
      for (var k = closes.length - 1; k >= 0; k--) {
        if (closes[k] != null) { out[symbols[i]] = {price: closes[k], ts: ts[k]}; break; }
      }
    } catch (e) {}
  });
  return out;
}

// 트리거가 부르는 함수. 미국 동부시간 기준 개장 직전(08:45~09:29)에만 실제로 보냄
function checkPreMarketAlert(e) {
  var force = (e === true);
  var now = new Date();
  var etDate = Utilities.formatDate(now, "America/New_York", "yyyy-MM-dd");
  var etHm = Number(Utilities.formatDate(now, "America/New_York", "HHmm"));
  var etDow = Number(Utilities.formatDate(now, "America/New_York", "u")); // 1=월 ... 7=일

  if (!force) {
    if (etDow >= 6) { runLog("pre", "미국 주말이라 건너뜀"); return; }                       // 미국 주말
    if (etHm < 845 || etHm > 929) { runLog("pre", "시간대 아님 ET " + etHm + " (08:45~09:29만 보냄)"); return; }         // 개장 직전 시간대가 아님
    var cache = CacheService.getScriptCache();
    if (cache.get("pre_sent_" + etDate)) { runLog("pre", "오늘 이미 보냄"); return; }  // 오늘 이미 보냄
    cache.put("pre_sent_" + etDate, "1", 21600);
  }

  var sh = getHoldingsSheet();
  var last = sh.getLastRow();
  if (last < 2) return;

  var byToken = {}, symSet = {};
  sh.getRange(2, 1, last - 1, 5).getValues().forEach(function (r) {
    if (!r[0] || !r[1]) return;
    var sym = String(r[1]).toUpperCase();
    (byToken[r[0]] = byToken[r[0]] || []).push({symbol: sym, avgPrice: Number(r[2]) || null, strategy: String(r[4] || "default")});
    symSet[sym] = true;
  });
  if (typeof _watchForAlerts === "function") { try { _watchForAlerts(byToken, symSet); } catch (err) {} }   // 관심 종목도 같이
  var symbols = Object.keys(symSet);
  if (!symbols.length) return;

  var pre = fetchPreMarket(symbols);

  // 휴장일 판단: 오늘 날짜의 프리장 데이터가 하나도 없으면 보내지 않음
  var anyToday = symbols.some(function (s) {
    return pre[s] && Utilities.formatDate(new Date(pre[s].ts * 1000), "America/New_York", "yyyy-MM-dd") === etDate;
  });
  if (!anyToday && !force) { runLog("pre", "휴장일 판단: 오늘 프리장 데이터 없음"); return; }

  byToken = _regroupByDevice(byToken);
  var paused = getPausedSet(), nSig = 0, nSent = 0, nTok = 0;
  _signalCache = {};
  for (var token in byToken) {
    if (paused[token]) continue;
    nTok++;
    var withSignal = [];
    byToken[token].forEach(function (h) {
      try {
        var r = preMarketLine(h.symbol, h.avgPrice, pre[h.symbol], etDate, etDow, h.strategy, _ownStop(token, h.symbol));
        if (r.hasSignal) withSignal.push((h.watch ? "👀 관심 종목\n" : "") + r.text);
      } catch (err) {
        console.error(h.symbol + " 체크 실패: " + err.message); runLog("err", h.symbol + " 체크 실패: " + err.message);
      }
    });
    if (withSignal.length) {
      nSig += withSignal.length; nSent++;
      sendToToken(token, "🌅 개장 전 신호 " + withSignal.length + "건", withSignal.join("\n\n"));
    }
  }
  runLog("pre", "기기 " + nTok + "대 확인, 신호 " + nSig + "건, 발송 " + nSent + "대 / 종목 " + symbols.length + "개");
}

// 프리장 가격을 "오늘의 임시 일봉"으로 붙여서 기존 매수/매도/저점 로직을 그대로 다시 계산
var _preSignalCache = {};
function getSymbolAlertsPre(symbol, pmPrice, etDate, etDow) {
  var base = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol);
  var resps = UrlFetchApp.fetchAll([
    {url: base + "?range=2y&interval=1d", muteHttpExceptions: true},
    {url: base + "?range=10y&interval=1wk", muteHttpExceptions: true}
  ]);
  if (resps[0].getResponseCode() !== 200 || resps[1].getResponseCode() !== 200) return null;
  var dData = processYahooData(JSON.parse(resps[0].getContentText()));
  var wData = processYahooData(JSON.parse(resps[1].getContentText()));
  if (!dData || dData.closes.length < 60 || !wData) return null;

  // 오늘 날짜의 일봉이 이미 있으면 제거 (프리장 임시 봉으로 대체)
  var li = dData.timestamps.length - 1;
  if (Utilities.formatDate(new Date(dData.timestamps[li] * 1000), "America/New_York", "yyyy-MM-dd") === etDate) {
    ["opens", "closes", "highs", "lows", "volumes", "dates", "timestamps"].forEach(function (k) { dData[k].pop(); });
  }
  var prevClose = dData.closes[dData.closes.length - 1];
  dData.opens.push(prevClose);
  dData.closes.push(pmPrice);
  dData.highs.push(Math.max(prevClose, pmPrice));
  dData.lows.push(Math.min(prevClose, pmPrice));
  dData.volumes.push(0);
  dData.dates.push("pre");
  dData.timestamps.push(Math.floor(Date.now() / 1000));

  // 이번 주 주봉이 있으면 프리장 가격 반영
  var mondayMs = Date.parse(etDate + "T00:00:00Z") - (etDow - 1) * 86400000;
  var wl = wData.closes.length - 1;
  if (wData.timestamps[wl] * 1000 >= mondayMs) {
    wData.closes[wl] = pmPrice;
    wData.highs[wl] = Math.max(wData.highs[wl], pmPrice);
    wData.lows[wl] = Math.min(wData.lows[wl], pmPrice);
  }

  var len = dData.closes.length;
  var cp = dData.closes[len - 1];
  var haDaily = calculateHeikinAshi_GAS(dData);
  var haWeekly = calculateHeikinAshi_GAS(wData);
  var hLenW = haWeekly.closes.length;

  var longStopPrice = null;
  for (var i = hLenW - 1; i >= 1; i--) {
    if (haWeekly.closes[i] > haWeekly.opens[i] && haWeekly.closes[i - 1] <= haWeekly.opens[i - 1]) {
      longStopPrice = haWeekly.lows[i];
      break;
    }
  }
  if (!longStopPrice) longStopPrice = Math.min.apply(null, dData.lows.slice(-40));      // 깨졌다고 손절가를 내리지 않음

  var isHighpointSell = checkHighpointSellSignal(wData, haDaily);

  var _fl = haSignalFlags(dData, haDaily);
  var todayBuySignal = !!_fl.buy[len - 1], todaySellSignal = !!_fl.sell[len - 1];

  var cloverToday = false;
  var isExtremeLowArr = calculateIsExtremeLowArray(dData);
  var hadExtremeLowRecent5 = false;
  for (var k = Math.max(0, len - 5); k < len; k++) {
    if (isExtremeLowArr[k]) { hadExtremeLowRecent5 = true; break; }
  }
  if (hadExtremeLowRecent5) {
    var todayBull = haDaily.closes[len - 1] > haDaily.opens[len - 1];
    var yestBear = len >= 2 ? haDaily.closes[len - 2] <= haDaily.opens[len - 2] : false;
    cloverToday = todayBull && yestBear;
  }

  var alerts = [];
  if (longStopPrice && cp < longStopPrice && len >= 2 && dData.closes[len - 2] >= longStopPrice) alerts.push("🚨 장기손절가(" + longStopPrice.toFixed(2) + "$) 이탈 - 프리장가 " + cp.toFixed(2) + "$");   // 깬 날 한 번만
  if (isHighpointSell) alerts.push("🌋 초고점 매도 신호 발생 (주봉 과열 후 반전)");
  if (todaySellSignal) alerts.push("▼ 일반 매도 타점 발생 (일봉 하이킨아시 반전)");
  if (todayBuySignal) alerts.push("▲ 추가 매수 타점 발생 (일봉 하이킨아시 반전)");
  if (cloverToday) alerts.push("☘️ 저점매수 신호 발생");
  var ctx = getSignalContext(dData, wData, haDaily, haWeekly, symbol);
  alerts = decorateAlerts(alerts, ctx);
  return {price: prevClose, alerts: alerts, ctx: ctx};
}

function preMarketLine(symbol, avgPrice, pm, etDate, etDow, strategy, ownStop) {
  var info = getSymbolAlerts(symbol); // 전일 정규장 마감 기준 (비교용)
  if (!info) return {hasSignal: false, text: "🔸 " + symbol + ": 데이터 조회 실패"};

  var prevClose = info.price;
  var pmOk = pm && Utilities.formatDate(new Date(pm.ts * 1000), "America/New_York", "yyyy-MM-dd") === etDate;
  if (!pmOk) {
    var altsNoPm = applyStrategy(symbol, strategy, info.alerts, null, etDate);
    info = {price: info.price, alerts: altsNoPm, ctx: info.ctx};
    if (info.alerts.length === 0) return {hasSignal: false, text: "🔸 " + symbol + ": 신호 없음 (전일 종가 " + prevClose.toFixed(2) + "$ / 프리장 데이터 없음)"};
    return {hasSignal: true, text: "🔸 " + symbol + " (전일 종가 기준)\n" + info.alerts.join("\n") + "\n🌅 프리장 데이터 없음"};
  }

  var pre = getSymbolAlertsPre(symbol, pm.price, etDate, etDow);
  var alerts = pre ? pre.alerts : info.alerts;
  alerts = applyStrategy(symbol, strategy, alerts, pm.price, etDate);
  var chg = (pm.price - prevClose) / prevClose * 100;
  var chgTxt = (chg >= 0 ? "+" : "") + chg.toFixed(1) + "%";

  if (alerts.length === 0) {
    return {hasSignal: false, text: "🔸 " + symbol + ": 신호 없음 (프리장 " + pm.price.toFixed(2) + "$ " + chgTxt + ")"};
  }
  // 전일 종가 기준에는 없던 신호는 🆕 표시
  var before = {};
  info.alerts.forEach(function (a) { before[a.split(" ")[0]] = true; });
  var lines = alerts.map(function (a) { return (before[a.split(" ")[0]] ? "" : "🆕 ") + a; });
  lines.push("🌅 프리장 " + pm.price.toFixed(2) + "$ (전일 종가 " + prevClose.toFixed(2) + "$ 대비 " + chgTxt + ")");
  lines.push("※ 프리장 가격 기준 임시 신호예요. 정규장에서 바뀔 수 있어요.");
  var cx = (pre && pre.ctx) || info.ctx;
  if (avgPrice) {
    var pnl = (pm.price - avgPrice) / avgPrice * 100;
    lines.push("💰 평단가 " + avgPrice.toFixed(2) + "$ 대비 " + (pnl >= 0 ? "+" : "") + pnl.toFixed(1) + "%");
    if (ownStop > 0) { if (pm.price <= ownStop) lines.push("🛑 내 손절가(" + ownStop + "$) 아래예요"); }             // 직접 정한 손절가가 있으면 그것만 봄
    else if (cx && pnl <= -cx.cls.stopPct) lines.push("🛑 손절 참고선(평단 -" + cx.cls.stopPct + "%)에 도달했어요");
  }
  return {hasSignal: true, text: "🔸 " + symbol + "\n" + lines.join("\n")};
}

// 정규장 마감 직후(ET 16:05~16:50)에 오늘 일봉 기준 신호를 보냄. 신호 있는 종목만.
function checkPostCloseAlert(e) {
  var force = (e === true);
  var now = new Date();
  var etDate = Utilities.formatDate(now, "America/New_York", "yyyy-MM-dd");
  var etHm = Number(Utilities.formatDate(now, "America/New_York", "HHmm"));
  var etDow = Number(Utilities.formatDate(now, "America/New_York", "u"));

  if (!force) {
    if (etDow >= 6) { runLog("post", "미국 주말이라 건너뜀"); return; }
    if (etHm < 1605 || etHm > 1650) { runLog("post", "시간대 아님 ET " + etHm + " (16:05~16:50만 보냄)"); return; }
    var cache = CacheService.getScriptCache();
    if (cache.get("post_sent_" + etDate)) { runLog("post", "오늘 이미 보냄"); return; }
    cache.put("post_sent_" + etDate, "1", 21600);
  }

  var sh = getHoldingsSheet();
  var last = sh.getLastRow();
  if (last < 2) return;

  // 휴장일 판단: SPY의 마지막 거래일이 오늘이 아니면 보내지 않음
  if (!force) {
    try {
      var r = UrlFetchApp.fetch("https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=1d&interval=1d", {muteHttpExceptions: true});
      var t = JSON.parse(r.getContentText()).chart.result[0].meta.regularMarketTime;
      if (Utilities.formatDate(new Date(t * 1000), "America/New_York", "yyyy-MM-dd") !== etDate) { runLog("post", "휴장일 판단: SPY 마지막 거래일이 오늘이 아님"); return; }
    } catch (err) {}
  }

  var byToken = {};
  sh.getRange(2, 1, last - 1, 5).getValues().forEach(function (row) {
    if (!row[0] || !row[1]) return;
    (byToken[row[0]] = byToken[row[0]] || []).push({symbol: String(row[1]).toUpperCase(), avgPrice: Number(row[2]) || null, strategy: String(row[4] || "default")});
  });

  if (typeof _watchForAlerts === "function") { try { _watchForAlerts(byToken, null); } catch (err) {} }       // 관심 종목도 같이
  byToken = _regroupByDevice(byToken);
  var paused = getPausedSet(), nSig = 0, nSent = 0, nTok = 0, nSym = 0;
  _signalCache = {};
  for (var token in byToken) {
    if (paused[token]) continue;
    nTok++;
    var withSignal = [];
    byToken[token].forEach(function (h) {
      nSym++;
      try {
        var res = postCloseLine(h.symbol, h.avgPrice, h.strategy, _ownStop(token, h.symbol));
        if (res.hasSignal) withSignal.push((h.watch ? "👀 관심 종목\n" : "") + res.text);
      } catch (err) {
        console.error(h.symbol + " 체크 실패: " + err.message); runLog("err", h.symbol + " 체크 실패: " + err.message);
      }
    });
    if (withSignal.length) {
      nSig += withSignal.length; nSent++;
      sendToToken(token, "🔔 장 마감 신호 " + withSignal.length + "건", withSignal.join("\n\n"));
    }
  }
  runLog("post", "기기 " + nTok + "대 확인, 종목 " + nSym + "개, 신호 " + nSig + "건, 발송 " + nSent + "대");
}

// 마감 후 알림 한 줄 (신호 있을 때만 hasSignal)
function postCloseLine(symbol, avgPrice, strategy, ownStop) {
  var info = getSymbolAlerts(symbol);
  if (!info) return {hasSignal: false, text: ""};
  var alerts = applyStrategy(symbol, strategy, info.alerts, null, null);
  if (!alerts.length) return {hasSignal: false, text: ""};
  var lines = alerts.slice();
  lines.push("현재가 " + info.price.toFixed(2) + "$");
  if (avgPrice) {
    var pnl = (info.price - avgPrice) / avgPrice * 100;
    lines.push("💰 평단가 " + avgPrice.toFixed(2) + "$ 대비 " + (pnl >= 0 ? "+" : "") + pnl.toFixed(1) + "%");
    if (ownStop > 0) { if (info.price <= ownStop) lines.push("🛑 내 손절가(" + ownStop + "$) 아래예요"); }
    else if (info.ctx && pnl <= -info.ctx.cls.stopPct) lines.push("🛑 손절 참고선(평단 -" + info.ctx.cls.stopPct + "%)에 도달했어요");
  }
  return {hasSignal: true, text: "🔸 " + symbol + "\n" + lines.join("\n")};
}

// 한 번만 실행: 예전 트리거를 모두 지우고 새로 만듦
// 개장 전 2개(서머타임/겨울 대비) + 마감 후 2개
function setupPreMarketTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === "checkHoldingsAndAlert" || fn === "checkPreMarketAlert" || fn === "checkPostCloseAlert") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("checkPreMarketAlert").timeBased().everyDays(1).atHour(22).nearMinute(10).create();
  ScriptApp.newTrigger("checkPreMarketAlert").timeBased().everyDays(1).atHour(23).nearMinute(10).create();
  ScriptApp.newTrigger("checkPostCloseAlert").timeBased().everyDays(1).atHour(5).nearMinute(20).create();
  ScriptApp.newTrigger("checkPostCloseAlert").timeBased().everyDays(1).atHour(6).nearMinute(20).create();
  Logger.log("트리거 4개 생성 완료 (개장 전 2개 + 마감 후 2개)");
}

// 지금 바로 테스트
function testPreMarket() {
  checkPreMarketAlert(true);
  Logger.log("개장 전 테스트 완료");
}
function testPostClose() {
  checkPostCloseAlert(true);
  Logger.log("마감 후 테스트 완료");
}