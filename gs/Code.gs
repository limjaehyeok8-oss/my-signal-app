// ==========================================================
// Code.gs - 웹앱 진입점 / 알림 / 보유 종목 / 매일 점검
// (분석·차트·포트폴리오 표는 Analysis.gs에 있음)
// ==========================================================
var SPREADSHEET_ID = "1pxed003UARHf8-tPHZY6omLbxE0hGtnpzstcDQhkeew";
var TOKENS_SHEET = "tokens";
var HOLDINGS_SHEET = "holdings";

function getSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(TOKENS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(TOKENS_SHEET);
    sheet.appendRow(["token", "createdAt", "paused"]);
  }
  return sheet;
}

function getHoldingsSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(HOLDINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(HOLDINGS_SHEET);
    sh.appendRow(["token", "symbol", "avgPrice", "updatedAt"]);
  }
  return sh;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================================
// 웹앱 진입점
// ==========================================================
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === "fearGreed") return json(fearGreedData());
  return json({ok: true, time: new Date().toLocaleString("ko-KR", {timeZone: "Asia/Seoul"})});
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var token = data.token;
    var ex = handleExtra(data); if (ex) return json(ex);
    if (data.action === "register")      return json(registerToken(token));
    if (data.action === "setPaused")     return json(setPaused(token, data.paused));
    if (data.action === "addHolding")    return json(addHolding(token, data.symbol, data.avgPrice));
    if (data.action === "removeHolding") return json(removeHolding(token, data.symbol));
    if (data.action === "listHoldings")  return json(listHoldings(token));
    if (data.action === "search")        return json(searchSymbols(token, data.query));
    if (data.action === "analyze")       return json(analyzeCachedWeb(token, data.ticker, data.cb === 1, data.wb === 1));
    if (data.action === "portfolio")     return json(portfolioForWeb(token));
    if (data.action === "backtest")      return json(backtestForWeb(token, data.ticker, data.years));

    if (data.action === "send") {
      var secret = PropertiesService.getScriptProperties().getProperty("ADMIN_SECRET");
      if (!secret || data.secret !== secret) return json({ok: false, msg: "권한 없음"});
      return json(sendPush(data.title, data.body));
    }
    return json({ok: false, msg: "알 수 없는 action"});
  } catch (err) {
    return json({ok: false, msg: String(err)});
  }
}

// ==========================================================
// 토큰 등록 / 알림 끄기·켜기
// ==========================================================
function registerToken(token) {
  if (!token || typeof token !== "string" || token.length < 50) {
    return {ok: false, msg: "잘못된 토큰"};
  }
  var result, added = false;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet();
    var last = sheet.getLastRow();
    if (last > 1) {
      var existing = sheet.getRange(2, 1, last - 1, 3).getValues();
      for (var i = 0; i < existing.length; i++) {
        if (existing[i][0] === token) { result = {ok: true, msg: "이미 등록됨", paused: existing[i][2] === true}; break; }
      }
    }
    if (!result) {
      sheet.appendRow([token, new Date(), false]);
      added = true;
      result = {ok: true, msg: "등록 성공", paused: false};
    }
  } finally {
    lock.releaseLock();
  }
  if (added) { try { mergeDeviceTokens(token); } catch (e) {} }   // 락을 놓은 뒤에 정리
  return result;
}

// 등록 확인 (30분 동안 기억해서 모든 요청이 빨라져요)
function isRegistered(token) {
  if (!token) return false;
  var cache = CacheService.getScriptCache();
  var key = "reg_" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(token)));
  if (cache.get(key)) return true;
  var sh = getSheet();
  var last = sh.getLastRow();
  if (last < 2) return false;
  var vals = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === token) { try { cache.put(key, "1", 1800); } catch (e) {} return true; }
  }
  return false;
}

function setPaused(token, paused) {
  if (!token) return {ok: false, msg: "잘못된 토큰"};
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getSheet();
    var last = sh.getLastRow();
    if (last < 2) return {ok: false, msg: "등록된 기기가 아니에요"};
    var vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (vals[i][0] === token) {
        sh.getRange(1, 3).setValue("paused");
        sh.getRange(i + 2, 3).setValue(paused === true);
        return {ok: true, paused: paused === true, msg: paused ? "알림을 껐어요" : "알림을 켰어요"};
      }
    }
    return {ok: false, msg: "등록된 기기가 아니에요"};
  } finally {
    lock.releaseLock();
  }
}

function getPausedSet() {
  var sh = getSheet();
  var last = sh.getLastRow();
  var set = {};
  if (last < 2) return set;
  sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) {
    if (r[2] === true) set[r[0]] = true;
  });
  return set;
}

// ==========================================================
// FCM 인증 / 발송
// ==========================================================
function getAccessToken() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("fcm_access_token");
  if (cached) return cached;

  var props = PropertiesService.getScriptProperties();
  var clientEmail = props.getProperty("CLIENT_EMAIL");
  var privateKey = props.getProperty("PRIVATE_KEY").replace(/\\n/g, "\n");

  var now = Math.floor(Date.now() / 1000);
  var header = Utilities.base64EncodeWebSafe(JSON.stringify({alg: "RS256", typ: "JWT"}));
  var claim = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  var unsigned = header + "." + claim;
  var signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(unsigned, privateKey)
  );

  var res = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + signature
    },
    muteHttpExceptions: true
  });
  var result = JSON.parse(res.getContentText());
  if (!result.access_token) throw new Error("토큰 발급 실패: " + res.getContentText());

  cache.put("fcm_access_token", result.access_token, 3000);
  return result.access_token;
}

// 종목 알림을 누르면 열리는 화면(내 종목)
var HOME_LINK = "https://limjaehyeok8-oss.github.io/my-signal-app/#home";

// 알림을 켠 전체 구독자에게 발송 (병렬 + 만료 토큰 자동 삭제)
function sendPush(title, body) {
  var sheet = getSheet();
  var last = sheet.getLastRow();
  if (last < 2) return {ok: false, msg: "등록된 구독자 없음 (tokens 시트 확인)"};

  var tokens = sheet.getRange(2, 1, last - 1, 3).getValues()
    .filter(function (r) { return r[2] !== true; })
    .map(function (r) { return String(r[0]).trim(); })
    .filter(String);
  if (!tokens.length) return {ok: false, msg: "알림을 켠 구독자가 없어요"};

  var projectId = PropertiesService.getScriptProperties().getProperty("PROJECT_ID");
  var accessToken = getAccessToken();
  var url = "https://fcm.googleapis.com/v1/projects/" + projectId + "/messages:send";

  var requests = tokens.map(function (t) {
    return {
      url: url,
      method: "post",
      contentType: "application/json",
      headers: {Authorization: "Bearer " + accessToken},
      payload: JSON.stringify({message: {token: t, notification: {title: title, body: body}, data: {url: HOME_LINK}, webpush: {fcm_options: {link: HOME_LINK}}}}),
      muteHttpExceptions: true
    };
  });

  var responses = UrlFetchApp.fetchAll(requests);
  var success = 0, dead = [];
  responses.forEach(function (r, i) {
    var code = r.getResponseCode();
    if (code === 200) success++;
    else if (code === 404 || r.getContentText().indexOf("UNREGISTERED") > -1) dead.push(tokens[i]);
    else Logger.log("실패(" + code + "): " + r.getContentText());
  });

  if (dead.length) {                                  // 만료된 주소 정리: 그 기기의 마지막 토큰이면 지우지 않음 (친구 목록에서 사라짐 방지)
    var all = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
    var cnt = {};
    all.slice(1).forEach(function (r) { var d = _dev(String(r[0])); cnt[d] = (cnt[d] || 0) + 1; });
    for (var row = all.length - 1; row >= 1; row--) {
      var tk = all[row][0], dv = _dev(String(tk));
      if (dead.indexOf(tk) > -1 && cnt[dv] > 1) { sheet.deleteRow(row + 1); cnt[dv]--; }
    }
  }

  var msg = "성공 " + success + " / 전체 " + tokens.length + " / 삭제 " + dead.length;
  Logger.log(msg);
  return {ok: true, msg: msg};
}

// 특정 기기 한 곳에만 발송
function sendToToken(token, title, body) {
  try { logAlert(token, title, body); } catch (e) {}
  var projectId = PropertiesService.getScriptProperties().getProperty("PROJECT_ID");
  var res = UrlFetchApp.fetch("https://fcm.googleapis.com/v1/projects/" + projectId + "/messages:send", {
    method: "post",
    contentType: "application/json",
    headers: {Authorization: "Bearer " + getAccessToken()},
    payload: JSON.stringify({message: {token: token, notification: {title: title, body: body}, data: {url: HOME_LINK}, webpush: {fcm_options: {link: HOME_LINK}}}}),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    Logger.log("푸시 실패(" + code + "): " + res.getContentText());
    if (code === 404 || res.getContentText().indexOf("UNREGISTERED") > -1) removeDeadToken(token);
  }
}

function removeDeadToken(token) {
  var sheet = getSheet(), vals = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues(), dv = _dev(String(token)), same = 0, r;
  for (r = 1; r < vals.length; r++) if (_dev(String(vals[r][0])) === dv) same++;
  if (same <= 1) return;                                // 그 기기의 마지막 토큰이면 지우지 않음
  for (r = vals.length; r >= 2; r--) {
    if (vals[r - 1][0] === token) sheet.deleteRow(r);
  }
  // 보유 종목은 지우지 않음 (같은 기기의 다른 토큰으로도 쓰이고, 친구 목록에서 사라지는 원인이 됨)
}

// ==========================================================
// 종목 검색 / 보유 종목 (웹앱에서 입력·조회·삭제)
// ==========================================================
function searchSymbols(token, query) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  query = String(query || "").trim().slice(0, 40);
  if (!query) return {ok: true, results: []};

  var cache = CacheService.getScriptCache();
  var key = "search_" + encodeURIComponent(query.toLowerCase()).slice(0, 200);
  var cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  // 한글로 검색하면 네이버 종목 자동완성으로 찾아요 (국장은 코드.KS / 코드.KQ, 미국 주식은 티커로 바꿔 줌)
  if (/[가-힣]/.test(query)) {
    try {
      var kr = _searchNaver(query);
      if (kr.length) { var outK = {ok: true, results: kr}; cache.put(key, JSON.stringify(outK), 3600); return outK; }
    } catch (e) {}
  }

  var res = UrlFetchApp.fetch(
    "https://query1.finance.yahoo.com/v1/finance/search?q=" + encodeURIComponent(query) +
    "&quotesCount=8&newsCount=0&lang=ko-KR",
    {headers: {"User-Agent": "Mozilla/5.0"}, muteHttpExceptions: true}
  );
  if (res.getResponseCode() !== 200) return {ok: false, msg: "검색 실패, 잠시 후 다시 시도하세요"};

  var quotes = (JSON.parse(res.getContentText()).quotes || [])
    .filter(function (q) { return q.symbol && (q.quoteType === "EQUITY" || q.quoteType === "ETF"); })
    .map(function (q) {
      return {symbol: q.symbol, name: q.shortname || q.longname || "", exchange: q.exchDisp || q.exchange || "", type: q.quoteType};
    });

  var out = {ok: true, results: quotes};
  cache.put(key, JSON.stringify(out), 3600);
  return out;
}

function _searchNaver(query) {
  var r = UrlFetchApp.fetch("https://ac.stock.naver.com/ac?q=" + encodeURIComponent(query) + "&target=stock",
    {headers: {"User-Agent": "Mozilla/5.0"}, muteHttpExceptions: true});
  if (r.getResponseCode() !== 200) return [];
  var items = JSON.parse(r.getContentText()).items || [], out = [];
  items.forEach(function (it) {
    if (!it || typeof it !== "object" || Array.isArray(it)) return;
    var code = String(it.code || "").toUpperCase(), type = String(it.typeCode || "").toUpperCase(), nation = String(it.nationCode || "").toUpperCase(), sym = "";
    if (nation === "KOR" || /^[0-9][0-9A-Z]{5}$/.test(code)) {
      if (type.indexOf("KOSDAQ") !== -1) sym = code + ".KQ";
      else if (type.indexOf("KOSPI") !== -1 || type === "") sym = code + ".KS";
      else return;                                                  // 코넥스 등은 야후에 없어서 뺌
    } else if (nation === "USA" && /^[A-Z.\-]{1,6}$/.test(code)) sym = code;
    else return;
    if (out.length < 8) out.push({symbol: sym, name: String(it.name || ""), exchange: String(it.typeName || it.typeCode || ""), type: "EQUITY"});
  });
  return out;
}

function fetchPrices(symbols) {
  var reqs = symbols.map(function (s) {
    return {
      url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=5d&interval=1d",
      muteHttpExceptions: true
    };
  });
  var resps = UrlFetchApp.fetchAll(reqs);
  var out = {};
  resps.forEach(function (r, i) {
    try { out[symbols[i]] = JSON.parse(r.getContentText()).chart.result[0].meta.regularMarketPrice; }
    catch (e) { out[symbols[i]] = null; }
  });
  return out;
}

function addHolding(token, symbol, avgPrice) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  symbol = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) return {ok: false, msg: "티커 형식이 올바르지 않아요"};
  avgPrice = parseFloat(avgPrice);
  if (isNaN(avgPrice) || avgPrice <= 0) avgPrice = "";

  if (fetchPrices([symbol])[symbol] == null) return {ok: false, msg: symbol + " 종목을 찾을 수 없어요"};

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getHoldingsSheet();
    var last = sh.getLastRow();
    if (last > 1) {
      var rows = sh.getRange(2, 1, last - 1, 2).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (_dev(rows[i][0]) === _dev(token) && rows[i][1] === symbol) {
          sh.getRange(i + 2, 3, 1, 2).setValues([[avgPrice, new Date()]]);
          return {ok: true, msg: symbol + " 평단가 수정됨"};
        }
      }
    }
    sh.appendRow([token, symbol, avgPrice, new Date()]);
    return {ok: true, msg: symbol + " 등록 완료"};
  } finally {
    lock.releaseLock();
  }
}

function removeHolding(token, symbol) {
  symbol = String(symbol || "").trim().toUpperCase();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getHoldingsSheet(), removed = 0;
    for (var r = sh.getLastRow(); r >= 2; r--) {
      var row = sh.getRange(r, 1, 1, 2).getValues()[0];
      if (_dev(row[0]) === _dev(token) && row[1] === symbol) { sh.deleteRow(r); removed++; }
    }
    if (removed) return {ok: true, msg: symbol + " 삭제됨"};
    return {ok: false, msg: "해당 종목이 없어요"};
  } finally {
    lock.releaseLock();
  }
}

function listHoldings(token) {
  var sh = getHoldingsSheet();
  var last = sh.getLastRow();
  if (last < 2) return {ok: true, holdings: []};
  var seenSym = {}, rows = [];
  sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) {      // 같은 폰의 옛 토큰에 붙은 종목도 같이 보여줌
    if (_dev(r[0]) !== _dev(token) || !r[1]) return;
    if (seenSym[r[1]] !== undefined) rows[seenSym[r[1]]] = r; else { seenSym[r[1]] = rows.length; rows.push(r); }
  });
  var symbols = rows.map(function (r) { return r[1]; });
  var prices = symbols.length ? _cachedPrices(symbols) : {};
  var list = rows.map(function (r) {
    var avg = Number(r[2]) || null, price = prices[r[1]];
    return {symbol: r[1], avgPrice: avg, price: price, pnl: (avg && price) ? (price / avg - 1) * 100 : null};
  });
  return {ok: true, holdings: list};
}

// ==========================================================
// 매일 보유 종목 점검 + 개인별 푸시 (신호 없음도 포함)
// ==========================================================
var _signalCache = {};

// 보유 종목에 적힌 토큰이 옛날 것이어도, 그 기기의 "지금 살아 있는 토큰"으로 알림이 가게 묶어 줌
function _regroupByDevice(byToken) {
  var sh = getSheet(), last = sh.getLastRow(), cur = {};
  if (last >= 2) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
    var t = String(r[0] || "").trim(); if (t) cur[_dev(t)] = t;            // 같은 기기는 맨 아래(최신) 줄이 이김
  });
  var out = {}, seen = {};
  for (var tk in byToken) {
    var key = cur[_dev(tk)] || tk;
    out[key] = out[key] || []; seen[key] = seen[key] || {};
    byToken[tk].forEach(function (h) {
      var s = String(h.symbol).toUpperCase();
      if (seen[key][s] != null) out[key][seen[key][s]] = h; else { seen[key][s] = out[key].length; out[key].push(h); }
    });
  }
  return out;
}

function checkHoldingsAndAlert() {
  var day = new Date().getDay(); // 일(0), 월(1)엔 새 일봉이 없어서 건너뜀
  if (day === 0 || day === 1) return;

  var sh = getHoldingsSheet();
  var last = sh.getLastRow();
  if (last < 2) return;

  var byToken = {};
  sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) {
    if (!r[0] || !r[1]) return;
    (byToken[r[0]] = byToken[r[0]] || []).push({symbol: r[1], avgPrice: Number(r[2]) || null});
  });

  byToken = _regroupByDevice(byToken);
  var paused = getPausedSet();
  _signalCache = {};
  for (var token in byToken) {
    if (paused[token]) continue;
    var withSignal = [], noSignal = [];
    byToken[token].forEach(function (h) {
      try {
        var r = checkOneHoldingAndAlert(h.symbol, h.avgPrice);
        (r.hasSignal ? withSignal : noSignal).push(r.text);
      } catch (e) {
        console.error(h.symbol + " 체크 실패: " + e.message);
      }
    });
    var all = withSignal.concat(noSignal); // 신호 있는 종목이 위로
    if (all.length) {
      var title = withSignal.length ? "📋 보유 종목 신호 " + withSignal.length + "건" : "📋 보유 종목 점검 (신호 없음)";
      sendToToken(token, title, all.join("\n\n"));
    }
  }
}

function getSymbolAlerts(symbol) {
  if (_signalCache[symbol]) return _signalCache[symbol];

  var base = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol);
  var resps = UrlFetchApp.fetchAll([
    {url: base + "?range=2y&interval=1d", muteHttpExceptions: true},
    {url: base + "?range=10y&interval=1wk", muteHttpExceptions: true}
  ]);
  if (resps[0].getResponseCode() !== 200 || resps[1].getResponseCode() !== 200) return null;

  var dData = processYahooData(JSON.parse(resps[0].getContentText()));
  var wData = processYahooData(JSON.parse(resps[1].getContentText()));
  if (!dData || dData.closes.length < 60 || !wData) return null;

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
  if (longStopPrice && cp < longStopPrice && len >= 2 && dData.closes[len - 2] >= longStopPrice) alerts.push("🚨 장기손절가(" + longStopPrice.toFixed(2) + "$) 이탈 - 현재가 " + cp.toFixed(2) + "$");   // 깬 날 한 번만
  if (isHighpointSell) alerts.push("🌋 초고점 매도 신호 발생 (주봉 과열 후 반전)");
  if (todaySellSignal) alerts.push("🔴 일반 매도 타점 발생 (일봉 하이킨아시 반전)");
  if (todayBuySignal) alerts.push("🟢 추가 매수 타점 발생 (일봉 하이킨아시 반전)");
  if (cloverToday) alerts.push("☘️ 저점매수 신호 발생");

  var ctx = getSignalContext(dData, wData, haDaily, haWeekly, symbol);
  alerts = decorateAlerts(alerts, ctx);
  return (_signalCache[symbol] = {price: cp, alerts: alerts, ctx: ctx});
}

function checkOneHoldingAndAlert(symbol, avgPrice) {
  var info = getSymbolAlerts(symbol);
  if (!info) return {hasSignal: false, text: "🔸 " + symbol + ": 데이터 조회 실패"};

  var pnlLine = "";
  if (avgPrice) {
    var pnlPct = ((info.price - avgPrice) / avgPrice) * 100;
    pnlLine = "💰 평단가 " + avgPrice.toFixed(2) + "$ 대비 " + (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(1) + "%";
  }
  if (info.alerts.length === 0) {
    return {hasSignal: false, text: "🔸 " + symbol + ": 신호 없음 (현재가 " + info.price.toFixed(2) + "$)"};
  }
  var lines = info.alerts.slice();
  if (pnlLine) lines.push(pnlLine);
  return {hasSignal: true, text: "🔸 " + symbol + "\n" + lines.join("\n")};
}

// ==========================================================
// 두 파일이 같이 쓰는 기본 지표
// ==========================================================
function processYahooData(data) {
  if (!data || !data.chart || !data.chart.result) return null;
  var res = data.chart.result[0];
  var q = res.indicators.quote[0];
  var adj = (res.indicators.adjclose && res.indicators.adjclose[0] && res.indicators.adjclose[0].adjclose)
    ? res.indicators.adjclose[0].adjclose
    : q.close;
  var timestamps = res.timestamp;
  var f = {opens: [], closes: [], highs: [], lows: [], volumes: [], dates: [], timestamps: []};

  for (var i = 0; i < adj.length; i++) {
    if (adj[i] != null && q.open[i] != null && q.high[i] != null && q.low[i] != null && q.volume[i] != null) {
      f.opens.push(parseFloat(q.open[i]));
      f.closes.push(parseFloat(adj[i]));
      f.highs.push(parseFloat(q.high[i]));
      f.lows.push(parseFloat(q.low[i]));
      f.volumes.push(parseFloat(q.volume[i]));
      var d = new Date(timestamps[i] * 1000);
      var m = (d.getMonth() + 1).toString().padStart(2, '0');
      var day = d.getDate().toString().padStart(2, '0');
      f.dates.push(m + "-" + day);
      f.timestamps.push(timestamps[i]);
    }
  }
  var gran = res.meta && res.meta.dataGranularity;
  if (gran === "1wk" || gran === "1mo") {                  // 야후는 주봉·월봉 끝에 '오늘' 봉을 따로 하나 더 줌 → 같은 주·달이면 한 봉으로 합침
    var L = f.closes.length - 1;
    while (L >= 1 && _samePeriod(f.timestamps[L - 1], f.timestamps[L], gran)) {
      f.closes[L - 1] = f.closes[L]; f.highs[L - 1] = Math.max(f.highs[L - 1], f.highs[L]); f.lows[L - 1] = Math.min(f.lows[L - 1], f.lows[L]);
      f.volumes[L - 1] += f.volumes[L]; f.dates[L - 1] = f.dates[L]; f.timestamps[L - 1] = f.timestamps[L];
      ["opens", "closes", "highs", "lows", "volumes", "dates", "timestamps"].forEach(function (k) { f[k].pop(); });
      L--;
    }
  }
  return (f.closes.length > 0) ? f : null;
}

// 두 시각(초)이 같은 주(월요일 시작) / 같은 달인지 (gran: "1wk" | "1mo")
function _samePeriod(t1, t2, gran) {
  if (gran === "1mo") { var a = new Date(t1 * 1000), b = new Date(t2 * 1000); return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth(); }
  return Math.floor((Math.floor(t1 / 86400) + 3) / 7) === Math.floor((Math.floor(t2 / 86400) + 3) / 7);
}
// 직접 만든 배열(o,h,l,c,t)에서 끝의 같은 주·달 봉을 합침 (arr 의 null 은 건너뜀)
function _mergeLastPeriod(gran, t, o, h, l, c) {
  if (gran !== "1wk" && gran !== "1mo") return;
  var L = t.length - 1;
  while (L >= 1 && _samePeriod(t[L - 1], t[L], gran)) {
    c[L - 1] = c[L]; if (h) h[L - 1] = Math.max(h[L - 1], h[L]); if (l) l[L - 1] = Math.min(l[L - 1], l[L]); t[L - 1] = t[L];
    [o, h, l, c, t].forEach(function (a) { if (a) a.pop(); });
    L--;
  }
}

function calculateMA(data, period) {
  return data.length < period ? 0 : data.slice(-period).reduce(function (a, b) { return a + b; }, 0) / period;
}

function calculateHeikinAshi_GAS(yahooData) {
  var closes = yahooData.closes, opens = yahooData.opens, highs = yahooData.highs, lows = yahooData.lows;
  var len = closes.length;
  var haCloses = [], haOpens = [], haHighs = [], haLows = [];
  if (len === 0) return {closes: [], opens: [], highs: [], lows: []};
  haCloses.push((opens[0] + highs[0] + lows[0] + closes[0]) / 4);
  haOpens.push((opens[0] + closes[0]) / 2);
  haHighs.push(highs[0]);
  haLows.push(lows[0]);
  for (var i = 1; i < len; i++) {
    var c = (opens[i] + highs[i] + lows[i] + closes[i]) / 4;
    var o = (haOpens[i - 1] + haCloses[i - 1]) / 2;
    haCloses.push(c); haOpens.push(o);
    haHighs.push(Math.max(highs[i], o, c));
    haLows.push(Math.min(lows[i], o, c));
  }
  return {closes: haCloses, opens: haOpens, highs: haHighs, lows: haLows};
}

function calculateWilderRSI(closes, period) {
  if (!closes || closes.length <= period) return [];
  var rsi = [];
  var g = 0, l = 0;
  for (var i = 1; i <= period; i++) {
    var d = closes[i] - closes[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  var ag = g / period, al = l / period;
  for (var j = period + 1; j < closes.length; j++) {
    var dd = closes[j] - closes[j - 1];
    ag = (ag * (period - 1) + (dd >= 0 ? dd : 0)) / period;
    al = (al * (period - 1) + (dd < 0 ? -dd : 0)) / period;
    rsi.push(al === 0 ? 100 : 100 - (100 / (1 + (ag / al))));
  }
  return rsi;
}

function calculateBollingerUpperArray(closes, period, multiplier) {
  var result = [];
  for (var i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    var slice = closes.slice(i - period + 1, i + 1);
    var ma = slice.reduce(function (a, b) { return a + b; }, 0) / period;
    var variance = slice.reduce(function (s, v) { return s + Math.pow(v - ma, 2); }, 0) / period;
    result.push(ma + Math.sqrt(variance) * multiplier);
  }
  return result;
}

function calculateBollingerLowerArray(closes, period, multiplier) {
  var result = [];
  for (var i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    var slice = closes.slice(i - period + 1, i + 1);
    var ma = slice.reduce(function (a, b) { return a + b; }, 0) / period;
    var variance = slice.reduce(function (s, v) { return s + Math.pow(v - ma, 2); }, 0) / period;
    result.push(ma - Math.sqrt(variance) * multiplier);
  }
  return result;
}

// ☘️ 초저점: (저가 <= 볼린저 하단) AND (RSI14 <= 30)
function calculateIsExtremeLowArray(dData) {
  var closes = dData.closes, lows = dData.lows, len = closes.length;
  var rsi14Full = calculateWilderRSI(closes, 14);
  var rsiOffset = len - rsi14Full.length;
  var bbLowerFull = calculateBollingerLowerArray(closes, 20, 2);
  var isExtremeLow = new Array(len).fill(false);
  for (var i = 0; i < len; i++) {
    var rsiIdx = i - rsiOffset;
    var rsi = (rsiIdx >= 0 && rsiIdx < rsi14Full.length) ? rsi14Full[rsiIdx] : null;
    var bbLower = bbLowerFull[i];
    if (rsi !== null && bbLower !== null && lows[i] <= bbLower && rsi <= 30) isExtremeLow[i] = true;
  }
  return isExtremeLow;
}

// 장기 고점(주봉 과열) 매도 판정
function checkHighpointSellSignal(wData, haDaily) {
  var wCloses = wData.closes, wHighs = wData.highs, wLen = wCloses.length;
  if (wLen < 25) return false;
  var wRsiFull = calculateWilderRSI(wCloses, 14);
  var wBbUpperFull = calculateBollingerUpperArray(wCloses, 20, 2);
  var rsiOffset = wLen - wRsiFull.length;

  var isExtremeHigh = [];
  for (var i = 0; i < wLen; i++) {
    var rsiIdx = i - rsiOffset;
    var rsi = (rsiIdx >= 0 && rsiIdx < wRsiFull.length) ? wRsiFull[rsiIdx] : null;
    var bbUpper = wBbUpperFull[i];
    isExtremeHigh.push(rsi !== null && bbUpper !== null && wHighs[i] >= bbUpper && rsi >= 70);
  }
  var recentEdge = false;
  for (var j = Math.max(1, wLen - 2); j < wLen; j++) {
    if (isExtremeHigh[j] && !isExtremeHigh[j - 1]) { recentEdge = true; break; }
  }
  var hLenD = haDaily.closes.length;
  var dailyTurnedBearish = false;
  if (hLenD >= 2) {
    dailyTurnedBearish = haDaily.closes[hLenD - 1] <= haDaily.opens[hLenD - 1] &&
                         haDaily.closes[hLenD - 2] > haDaily.opens[hLenD - 2];
  }
  return recentEdge && dailyTurnedBearish;
}

// ==========================================================
// 트리거 설정 / 테스트
// ==========================================================

// 한 번만 실행: 매일 밤 10시 무렵 보유 종목 점검 (이미 만든 트리거가 있으면 먼저 삭제하세요)
function setupHoldingsTrigger() {
  ScriptApp.newTrigger("checkHoldingsAndAlert").timeBased().everyDays(1).atHour(22).nearMinute(5).create();
}

// 알림을 켠 전체 구독자에게 테스트 알림
function testSend() {
  Logger.log(JSON.stringify(sendPush("테스트", "푸시 알림이 정상 작동합니다!")));
}

// 보유 종목 점검을 지금 바로 실행
function testHoldingsCheck() {
  Logger.log("holdings 행 수: " + (getHoldingsSheet().getLastRow() - 1));
  checkHoldingsAndAlert();
  Logger.log("점검 완료");
}
function testSearchKr() { Logger.log(UrlFetchApp.fetch("https://ac.stock.naver.com/ac?q=" + encodeURIComponent("인버스") + "&target=stock", {muteHttpExceptions: true}).getContentText().slice(0, 800)); Logger.log(JSON.stringify(_searchNaver("인버스"))); }
