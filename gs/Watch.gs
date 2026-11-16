// ===== Watch.gs : 👀 관심 종목 (목표가 알림 + 신호 알림) =====
// 처음 한 번: setupWatchTrigger 실행 (미국 장중 10분마다 목표가 도달을 확인)
// 시트 "watch": [token, symbol, target, dir, createdAt, firedAt]
var WATCH_SHEET = "watch", WATCH_MAX = 30;

function _watchSheet() {
  var ss = getSheet().getParent(), sh = ss.getSheetByName(WATCH_SHEET);
  if (!sh) { sh = ss.insertSheet(WATCH_SHEET); sh.getRange(1, 1, 1, 6).setValues([["token", "symbol", "target", "dir", "createdAt", "firedAt"]]); }
  return sh;
}
function _watchRows() {
  var sh = _watchSheet(), last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, 6).getValues();
}
function _watchDir(d) { return d === "down" ? "이하" : "이상"; }

function getWatch(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var me = _dev(token), mine = _watchRows().filter(function (r) { return r[0] && r[1] && _dev(r[0]) === me; });
  if (!mine.length) return {ok: true, items: []};
  var syms = mine.map(function (r) { return String(r[1]); });
  var px = {}, bd = {};
  try { px = _cachedPrices(syms); } catch (e) {}
  try { bd = _defaultBadges(syms); } catch (e) {}
  return {ok: true, items: mine.map(function (r) {
    var s = String(r[1]), t = Number(r[2]) || null, p = px[s] == null ? null : Number(px[s]);
    return {s: s, target: t, dir: String(r[3] || ""), px: p, gap: (t && p) ? Number(((t / p - 1) * 100).toFixed(1)) : null,
            badge: bd[s] || "", fired: !!r[5]};
  })};
}

function addWatch(token, symbol, target) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  symbol = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return {ok: false, msg: "티커를 확인하세요 (예: NVDA)"};
  target = Number(target) || 0;
  if (target < 0) return {ok: false, msg: "목표가를 확인하세요"};
  var p = null;
  try { p = fetchPrices([symbol])[symbol]; } catch (e) {}
  if (p == null) return {ok: false, msg: symbol + " 종목을 찾지 못했어요"};
  var dir = target ? (target < p ? "down" : "up") : "";
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var sh = _watchSheet(), rows = _watchRows(), me = _dev(token), cnt = 0;
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i][0] || _dev(rows[i][0]) !== me) continue;
      cnt++;
      if (String(rows[i][1]) === symbol) {                                 // 이미 있으면 목표가만 바꾸고 다시 대기
        sh.getRange(i + 2, 1, 1, 6).setValues([[token, symbol, target || "", dir, rows[i][4] || new Date(), ""]]);
        return {ok: true, msg: symbol + " 목표가를 바꿨어요"};
      }
    }
    if (cnt >= WATCH_MAX) return {ok: false, msg: "관심 종목은 " + WATCH_MAX + "개까지예요"};
    sh.appendRow([token, symbol, target || "", dir, new Date(), ""]);
  } finally { lock.releaseLock(); }
  return {ok: true, msg: symbol + " 추가됨" + (target ? " · $" + target + " " + _watchDir(dir) + "가 되면 알려드려요" : " · 신호가 뜨면 알려드려요")};
}

function removeWatch(token, symbol) {
  if (!isRegistered(token)) return {ok: false};
  symbol = String(symbol || "").trim().toUpperCase();
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var sh = _watchSheet(), rows = _watchRows(), me = _dev(token);
    for (var i = rows.length - 1; i >= 0; i--) if (rows[i][0] && _dev(rows[i][0]) === me && String(rows[i][1]) === symbol) sh.deleteRow(i + 2);
  } finally { lock.releaseLock(); }
  return {ok: true};
}

// 기기 → 지금 살아 있는 토큰·알림 꺼짐 여부
function _watchCurTokens() {
  var sh = getSheet(), last = sh.getLastRow(), m = {};
  if (last >= 2) sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) {
    var t = String(r[0] || "").trim(); if (t) m[_dev(t)] = {t: t, paused: r[2] === true};
  });
  return m;
}

// 10분마다: 목표가에 닿은 관심 종목이 있으면 한 번만 알림
function checkWatchTargets(force) {
  var now = new Date();
  var dow = Number(Utilities.formatDate(now, "America/New_York", "u")), hm = Number(Utilities.formatDate(now, "America/New_York", "HHmm"));
  if (force !== true && (dow >= 6 || hm < 930 || hm > 1605)) return "장 시간이 아님";
  var sh = _watchSheet(), rows = _watchRows(), todo = [], set = {};
  rows.forEach(function (r, i) { if (r[0] && r[1] && Number(r[2]) > 0 && !r[5]) { todo.push(i); set[String(r[1])] = 1; } });
  if (!todo.length) return "대기 중인 목표가 없음";
  var px = fetchPrices(Object.keys(set)), cur = _watchCurTokens(), sent = 0;
  todo.forEach(function (i) {
    var r = rows[i], s = String(r[1]), t = Number(r[2]), p = px[s];
    if (p == null) return;
    var hit = r[3] === "down" ? p <= t : p >= t;
    if (!hit) return;
    sh.getRange(i + 2, 6).setValue(new Date());                            // 한 번만 울리게 표시
    var c = cur[_dev(r[0])] || {t: String(r[0]), paused: false};
    if (c.paused) return;
    sendToToken(c.t, "🎯 목표가 도달: " + s, s + " 현재 $" + Number(p).toFixed(2) + " · 목표 $" + t + " " + _watchDir(r[3]) + "\n(관심 종목에서 목표가를 바꾸면 다시 알려드려요)");
    sent++;
  });
  return "알림 " + sent + "건";
}

// 개장 전·장 마감 신호 알림에 관심 종목도 같이 넣기 (보유 종목과 겹치면 넣지 않음)
function _watchForAlerts(byToken, symSet) {
  var keyOf = {}, has = {};
  for (var tk in byToken) {
    var d = _dev(tk); if (!keyOf[d]) keyOf[d] = tk;
    has[d] = has[d] || {};
    byToken[tk].forEach(function (h) { has[d][String(h.symbol).toUpperCase()] = 1; });
  }
  _watchRows().forEach(function (r) {
    if (!r[0] || !r[1]) return;
    var d = _dev(r[0]), s = String(r[1]).toUpperCase();
    has[d] = has[d] || {};
    if (has[d][s]) return;
    has[d][s] = 1;
    var key = keyOf[d] || (keyOf[d] = String(r[0]));
    (byToken[key] = byToken[key] || []).push({symbol: s, avgPrice: null, strategy: "default", watch: true});
    if (symSet) symSet[s] = true;
  });
}

function setupWatchTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "checkWatchTargets") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("checkWatchTargets").timeBased().everyMinutes(10).create();
  Logger.log("관심 종목 목표가 확인 시작: " + checkWatchTargets(true));
}


// ===== 🌙 장외 가격 (프리장·애프터장·데이장) =====
// 야후에서 가장 최근에 체결된 가격을 가져와요. 정규장이 아닐 때 종목 아래에 참고용으로 보여줍니다.
function getExtPrices(token, symbols) {
  if (!isRegistered(token)) return {ok: false};
  var syms = (symbols || []).map(function (s) { return String(s || "").trim().toUpperCase(); })
    .filter(function (s) { return /^[A-Z0-9.\-]{1,12}$/.test(s); }).slice(0, 40);
  if (!syms.length) return {ok: true, px: {}};
  var cache = CacheService.getScriptCache(), out = {}, need = [], hit = {};
  try { hit = cache.getAll(syms.map(function (s) { return "ext_" + s; })); } catch (e) {}
  syms.forEach(function (s) { if (hit["ext_" + s]) { try { out[s] = JSON.parse(hit["ext_" + s]); } catch (e) { need.push(s); } } else need.push(s); });
  if (need.length) {
    var resps = [];
    try {
      resps = UrlFetchApp.fetchAll(need.map(function (s) {
        return {url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=1d&interval=1m&includePrePost=true", muteHttpExceptions: true};
      }));
    } catch (e) {}
    var put = {};
    need.forEach(function (s, i) {
      try {
        var r = resps[i]; if (!r || r.getResponseCode() !== 200) return;
        var res = JSON.parse(r.getContentText()).chart.result[0], c = res.indicators.quote[0].close, ts = res.timestamp, reg = res.meta.regularMarketPrice;
        for (var k = c.length - 1; k >= 0; k--) {
          if (c[k] == null) continue;
          var d = new Date(ts[k] * 1000), hm = Number(Utilities.formatDate(d, "America/New_York", "HHmm"));
          var sess = (hm >= 930 && hm < 1600) ? "정규장" : (hm >= 400 && hm < 930) ? "프리장" : (hm >= 1600 && hm < 2000) ? "애프터장" : "데이장";
          var o = {px: Number(c[k]), sess: sess, chg: reg ? Number(((c[k] / reg - 1) * 100).toFixed(2)) : null,
                   at: Utilities.formatDate(d, "Asia/Seoul", "MM/dd HH:mm")};
          // 데이장(미국 야간 20:00~04:00, 일~목 밤): 야후 meta 의 fulldayPrice 가 야간 포함 최신가
          var now = new Date(), nh = Number(Utilities.formatDate(now, "America/New_York", "HHmm")), nd = Number(Utilities.formatDate(now, "America/New_York", "u"));
          var overnight = (nh >= 2000 && (nd === 7 || nd <= 4)) || (nh < 400 && nd >= 1 && nd <= 5);
          var fd = Number(res.meta.fulldayPrice);
          if (overnight && fd > 0) {
            o = {px: fd, sess: "데이장", chg: reg ? Number(((fd / reg - 1) * 100).toFixed(2)) : null, at: Utilities.formatDate(now, "Asia/Seoul", "MM/dd HH:mm")};
          }
          out[s] = o; put["ext_" + s] = JSON.stringify(o);
          return;
        }
      } catch (e) {}
    });
    try { cache.putAll(put, 15); } catch (e) {}
  }
  return {ok: true, px: out};
}


// 시장 히트맵: 여러 종목의 오늘 등락률 (일봉 마지막 두 종가 기준, 60초 캐시)
function getHeat(token, symbols) {
  if (!isRegistered(token)) return {ok: false};
  var syms = (symbols || []).map(function (s) { return String(s || "").trim().toUpperCase(); })
    .filter(function (s) { return /^[A-Z0-9.\-]{1,12}$/.test(s); }).slice(0, 40);
  if (!syms.length) return {ok: true, q: {}};
  var cache = CacheService.getScriptCache(), out = {}, need = [], hit = {};
  try { hit = cache.getAll(syms.map(function (s) { return "heat_" + s; })); } catch (e) {}
  syms.forEach(function (s) { if (hit["heat_" + s]) { try { out[s] = JSON.parse(hit["heat_" + s]); } catch (e) { need.push(s); } } else need.push(s); });
  if (need.length) {
    var resps = [];
    try {
      resps = UrlFetchApp.fetchAll(need.map(function (s) {
        return {url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=5d&interval=1d", muteHttpExceptions: true};
      }));
    } catch (e) {}
    var put = {};
    need.forEach(function (s, i) {
      try {
        var r = resps[i]; if (!r || r.getResponseCode() !== 200) return;
        var res = JSON.parse(r.getContentText()).chart.result[0], c = res.indicators.quote[0].close.filter(function (v) { return v != null; });
        if (c.length < 2) return;
        var o = {px: Number(c[c.length - 1].toFixed(2)), chg: Number(((c[c.length - 1] / c[c.length - 2] - 1) * 100).toFixed(2))};
        out[s] = o; put["heat_" + s] = JSON.stringify(o);
      } catch (e) {}
    });
    try { cache.putAll(put, 60); } catch (e) {}
  }
  return {ok: true, q: out};
}

// 확인용: Apps Script 편집기에서 testOvernight 를 실행하고 "실행 로그"를 보내 주세요
function testOvernight() {
  var url = "https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=2d&interval=5m&includePrePost=true";
  var r = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
  var res = JSON.parse(r.getContentText()).chart.result[0], ts = res.timestamp, c = res.indicators.quote[0].close;
  Logger.log("code=" + r.getResponseCode() + " bars=" + ts.length);
  Logger.log("meta keys: " + Object.keys(res.meta).join(","));
  var m = res.meta;
  Logger.log("regularMarketPrice=" + m.regularMarketPrice + " time=" + Utilities.formatDate(new Date(m.regularMarketTime * 1000), "Asia/Seoul", "MM/dd HH:mm") + " | fulldayPrice=" + m.fulldayPrice + " fulldayChange=" + m.fulldayChange + " fulldayChangePercent=" + m.fulldayChangePercent + " | regChg%=" + m.regularMarketChangePercent + " prevClose=" + m.previousClose);
  Logger.log("tradingPeriods: " + JSON.stringify(res.meta.currentTradingPeriod));
  for (var k = ts.length - 1, n = 0; k >= 0 && n < 6; k--, n++) {
    Logger.log(Utilities.formatDate(new Date(ts[k] * 1000), "Asia/Seoul", "MM/dd HH:mm") + " KST  close=" + c[k]);
  }
  var q = UrlFetchApp.fetch("https://query1.finance.yahoo.com/v7/finance/quote?symbols=NVDA", {muteHttpExceptions: true});
  Logger.log("quote code=" + q.getResponseCode() + " " + q.getContentText().slice(0, 600));
}