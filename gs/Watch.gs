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
  try { if (typeof checkHoldAlerts === "function") checkHoldAlerts(); } catch (e) {}      // 보유 종목 목표가·손절가 (장외 시간 포함)
  try { if (typeof checkBbAlerts === "function") checkBbAlerts(); } catch (e) {}          // 볼린저 하단 터치 (정규장)
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
  return {ok: true, px: _extPx(symbols)};
}
// 장외 포함 최신가 (토큰 확인 없이 서버 안에서 쓰는 용도). 한 번에 40개까지.
function _extPx(symbols) {
  var syms = (symbols || []).map(function (s) { return String(s || "").trim().toUpperCase(); })
    .filter(function (s) { return /^[A-Z0-9.\-]{1,12}$/.test(s); }).slice(0, 40);
  if (!syms.length) return {};
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
  return out;
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

// ===== 기업 가치 지표 (PER·PBR·시총 등): 야후 quote (쿠키+crumb 필요, 1시간 저장) =====
function _yhAuth(force) {
  var cache = CacheService.getScriptCache(), hit = force ? null : cache.get("yh_auth");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
  var r1 = UrlFetchApp.fetch("https://fc.yahoo.com", {muteHttpExceptions: true, followRedirects: false, headers: {"User-Agent": UA}});
  var sc = r1.getAllHeaders()["Set-Cookie"] || r1.getAllHeaders()["set-cookie"] || [];
  if (typeof sc === "string") sc = [sc];
  var cookie = sc.map(function (c) { return String(c).split(";")[0]; }).join("; ");
  if (!cookie) return null;
  var r2 = UrlFetchApp.fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {muteHttpExceptions: true, headers: {"User-Agent": UA, "Cookie": cookie}});
  var crumb = r2.getContentText();
  if (r2.getResponseCode() !== 200 || !crumb || crumb.length > 40 || crumb.indexOf("<") !== -1) return null;
  var a = {cookie: cookie, crumb: crumb, ua: UA};
  try { cache.put("yh_auth", JSON.stringify(a), 3600); } catch (e) {}
  return a;
}
function _yhQuote(syms) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var a = _yhAuth(attempt === 1);
    if (!a) continue;
    var r = UrlFetchApp.fetch("https://query2.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(syms.join(",")) + "&crumb=" + encodeURIComponent(a.crumb),
      {muteHttpExceptions: true, headers: {"User-Agent": a.ua, "Cookie": a.cookie}});
    if (r.getResponseCode() === 200) { try { return JSON.parse(r.getContentText()).quoteResponse.result || []; } catch (e) { return []; } }
  }
  return null;
}
function getFund(token, symbol) {
  if (!isRegistered(token)) return {ok: false};
  var s = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(s)) return {ok: false, msg: "티커 형식이 올바르지 않아요"};
  var cache = CacheService.getScriptCache(), ck = "fund3_" + s, hit = cache.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var q;
  try { q = _yhQuote([s]); } catch (e) { return {ok: false, msg: "가치 지표 오류: " + e.message}; }
  if (!q) return {ok: false, msg: "가치 지표를 불러오지 못했어요"};
  if (!q.length) return {ok: false, msg: s + " 가치 지표가 없어요"};
  var x = q[0], n = function (v, d) { return (typeof v === "number" && isFinite(v)) ? Number(v.toFixed(d == null ? 2 : d)) : null; };
  var sec = null;
  try { sec = _yhSector(s); } catch (e) {}
  var sh = null;
  try { sh = _yhShort(s); } catch (e) {}
  var out = {ok: true, s: s, sp: sh ? sh.sp : null, sr: sh ? sh.sr : null, sch: sh ? sh.ch : null, sdt: sh ? sh.dt : null, sec: sec ? sec.name : null, secPe: sec ? sec.pe : null, type: x.quoteType || "", pe: n(x.trailingPE, 1), fpe: n(x.forwardPE, 1), pbr: n(x.priceToBook, 1), eps: n(x.epsTrailingTwelveMonths),
             mcap: n(x.marketCap, 0), div: n(x.trailingAnnualDividendYield != null ? x.trailingAnnualDividendYield * 100 : null, 1)};
  try { cache.put(ck, JSON.stringify(out), 3600); } catch (e) {}
  return out;
}
function testFund() { Logger.log(JSON.stringify(getFundRaw_("NVDA"))); Logger.log(JSON.stringify(_yhSector("NVDA"))); Logger.log(JSON.stringify(_yhSectorPe())); }
function getFundRaw_(s) { var q = _yhQuote([s]); return q && q[0] ? {pe: q[0].trailingPE, fpe: q[0].forwardPE, pbr: q[0].priceToBook, mcap: q[0].marketCap} : q; }


// 업종 평균 PER: 종목의 업종(야후 assetProfile) → 그 업종 대표 ETF 의 PER 을 평균값으로 사용 (6시간 저장)
var YH_SECTOR = {"Technology": ["XLK", "기술"], "Financial Services": ["XLF", "금융"], "Healthcare": ["XLV", "헬스케어"], "Consumer Cyclical": ["XLY", "경기소비재"],
  "Consumer Defensive": ["XLP", "필수소비재"], "Energy": ["XLE", "에너지"], "Industrials": ["XLI", "산업재"], "Basic Materials": ["XLB", "소재"],
  "Utilities": ["XLU", "유틸리티"], "Real Estate": ["XLRE", "부동산"], "Communication Services": ["XLC", "통신·미디어"]};
function _yhSectorPe() {
  var cache = CacheService.getScriptCache(), hit = cache.get("yh_secpe");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var etfs = Object.keys(YH_SECTOR).map(function (k) { return YH_SECTOR[k][0]; }), q = _yhQuote(etfs), m = {};
  (q || []).forEach(function (x) { if (typeof x.trailingPE === "number" && x.trailingPE > 0) m[x.symbol] = Number(x.trailingPE.toFixed(1)); });
  if (Object.keys(m).length) { try { cache.put("yh_secpe", JSON.stringify(m), 21600); } catch (e) {} }
  return m;
}
// 공매도(숏) 비중: 유통주식 대비 공매도 잔량 %, 청산까지 걸리는 일수(Days to cover), 직전 집계 대비 변화. 야후는 2주마다 갱신(거래소 공시 기준)이라 며칠~2주 늦어요
function _yhShort(s) {
  var a = _yhAuth(false); if (!a) return null;
  var r = UrlFetchApp.fetch("https://query2.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(s) + "?modules=defaultKeyStatistics&crumb=" + encodeURIComponent(a.crumb),
    {muteHttpExceptions: true, headers: {"User-Agent": a.ua, "Cookie": a.cookie}});
  if (r.getResponseCode() !== 200) return null;
  var res = JSON.parse(r.getContentText()).quoteSummary.result, k = res && res[0] ? res[0].defaultKeyStatistics : null; if (!k) return null;
  var raw = function (o) { return o && typeof o.raw === "number" && isFinite(o.raw) ? o.raw : null; };
  var spf = raw(k.shortPercentOfFloat), sh = raw(k.sharesShort), pr = raw(k.sharesShortPriorMonth), sr = raw(k.shortRatio), dt = raw(k.dateShortInterest);
  if (spf == null && sh == null) return null;
  return {sp: spf != null ? Number((spf * 100).toFixed(1)) : null, sr: sr != null ? Number(sr.toFixed(1)) : null,
          ch: (sh != null && pr) ? Number(((sh / pr - 1) * 100).toFixed(0)) : null, dt: dt ? Utilities.formatDate(new Date(dt * 1000), "UTC", "MM/dd") : null};
}
function _yhSector(s) {
  var a = _yhAuth(false); if (!a) return null;
  var r = UrlFetchApp.fetch("https://query2.finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(s) + "?modules=assetProfile&crumb=" + encodeURIComponent(a.crumb),
    {muteHttpExceptions: true, headers: {"User-Agent": a.ua, "Cookie": a.cookie}});
  if (r.getResponseCode() !== 200) return null;
  var res = JSON.parse(r.getContentText()).quoteSummary.result;
  var sector = res && res[0] && res[0].assetProfile ? res[0].assetProfile.sector : null, def = sector ? YH_SECTOR[sector] : null;
  if (!def) return null;
  var pe = _yhSectorPe()[def[0]];
  return {name: def[1], pe: pe || null};
}


// ===== 과매도 뒤 성적: 최근 5년 동안 RSI(14)가 30 아래로 내려간 날 이후 수익률 통계 (6시간 저장) =====
function getOversold(token, symbol) {
  if (!isRegistered(token)) return {ok: false};
  var s = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(s)) return {ok: false, msg: "티커 형식이 올바르지 않아요"};
  var cache = CacheService.getScriptCache(), ck = "ovs_" + s, hit = cache.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var r = UrlFetchApp.fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=5y&interval=1d", {muteHttpExceptions: true});
  if (r.getResponseCode() !== 200) return {ok: false, msg: "데이터를 불러오지 못했어요"};
  var d = processYahooData(JSON.parse(r.getContentText()));
  if (!d || d.closes.length < 120) return {ok: false, msg: "데이터가 부족해요"};
  var out = _oversoldStats(d.closes);
  out.ok = true; out.s = s;
  try { cache.put(ck, JSON.stringify(out), 21600); } catch (e) {}
  return out;
}
function _oversoldStats(c) {
  var rsi = calculateWilderRSI(c, 14), off = c.length - rsi.length, n = c.length, TH = 30, ev = [], last = -99;
  for (var i = Math.max(1, off + 1); i < n; i++) {
    var a = rsi[i - off], b = rsi[i - 1 - off];
    if (a < TH && b >= TH && i - last >= 10) { ev.push(i); last = i; }      // 30 아래로 "내려간 날". 10거래일 안의 반복은 한 번으로 침
  }
  var rows = [5, 10, 20, 60].map(function (h) {
    var rets = [];
    ev.forEach(function (i) { if (i + h < n) rets.push((c[i + h] / c[i] - 1) * 100); });
    if (!rets.length) return {h: h, n: 0};
    var sum = 0, win = 0, worst = rets[0];
    rets.forEach(function (x) { sum += x; if (x > 0) win++; if (x < worst) worst = x; });
    return {h: h, n: rets.length, avg: Number((sum / rets.length).toFixed(1)), win: Math.round(win / rets.length * 100), worst: Number(worst.toFixed(1))};
  });
  var cur = rsi[rsi.length - 1];
  return {th: TH, cnt: ev.length, rows: rows, rsi: Number(cur.toFixed(0)), now: cur < TH, years: Number((n / 252).toFixed(1))};
}


// ===== 업종별 강도: 업종 대표 ETF 의 1주·1달·3달 수익률 (30분 저장) =====
var SECTOR_ETFS = [["SPY", "S&P500 (기준)"], ["QQQ", "나스닥100"], ["SMH", "반도체"], ["IGV", "소프트웨어"], ["XLK", "기술 전체"], ["XLC", "통신·미디어"],
  ["XLF", "금융"], ["KRE", "지역은행"], ["XLE", "에너지(석유)"], ["XLU", "전력·유틸리티"], ["URA", "원전·우라늄"], ["XLV", "헬스케어"], ["XBI", "바이오"],
  ["XLI", "산업재"], ["ITA", "방산·항공"], ["XLY", "경기소비재"], ["XLP", "필수소비재"], ["XLB", "소재"], ["XLRE", "부동산"], ["GDX", "금광"], ["TAN", "태양광"], ["IBIT", "비트코인"], ["ARKK", "혁신 성장주"]];
function getSectors(token) {
  if (!isRegistered(token)) return {ok: false};
  var cache = CacheService.getScriptCache(), hit = cache.get("sectors_v1");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var resps;
  try {
    resps = UrlFetchApp.fetchAll(SECTOR_ETFS.map(function (e) {
      return {url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(e[0]) + "?range=6mo&interval=1d", muteHttpExceptions: true};
    }));
  } catch (e) { return {ok: false, msg: "업종 데이터를 불러오지 못했어요"}; }
  var rows = [];
  SECTOR_ETFS.forEach(function (e, i) {
    try {
      if (resps[i].getResponseCode() !== 200) return;
      var c = JSON.parse(resps[i].getContentText()).chart.result[0].indicators.quote[0].close.filter(function (v) { return v != null; }), n = c.length;
      if (n < 70) return;
      var r = function (k) { return Number(((c[n - 1] / c[n - 1 - k] - 1) * 100).toFixed(1)); };
      rows.push({s: e[0], n: e[1], d1: r(1), w1: r(5), m1: r(21), m3: r(63)});
    } catch (err) {}
  });
  if (!rows.length) return {ok: false, msg: "업종 데이터를 불러오지 못했어요"};
  var out = {ok: true, rows: rows, at: Utilities.formatDate(new Date(), "Asia/Seoul", "MM/dd HH:mm")};
  try { cache.put("sectors_v1", JSON.stringify(out), 1800); } catch (e) {}
  return out;
}


// 업종 안의 대표 종목들 수익률 (업종 강도에서 줄을 눌렀을 때). 업종별 30분 저장
var SECTOR_STOCKS = {
  SPY: "AAPL MSFT NVDA GOOGL AMZN META TSLA AVGO LLY JPM BRK-B V WMT XOM", QQQ: "AAPL MSFT NVDA GOOGL AMZN META TSLA AVGO NFLX COST AMD PLTR CSCO",
  SMH: "NVDA AVGO AMD TSM MU INTC QCOM ASML AMAT LRCX KLAC MRVL TXN ARM SNDK WDC STX", IGV: "MSFT ORCL CRM ADBE NOW PLTR PANW CRWD SNOW DDOG NET ZS INTU WDAY TEAM",
  XLK: "AAPL MSFT NVDA AVGO ORCL CSCO IBM DELL ANET ACN HPE SMCI", XLC: "GOOGL META NFLX DIS TMUS VZ T CMCSA SPOT RBLX TTWO EA",
  XLF: "JPM BAC WFC GS MS C BLK AXP V MA SCHW COF BRK-B", KRE: "USB PNC TFC FITB RF KEY HBAN CFG MTB ZION WAL",
  XLE: "XOM CVX COP EOG OXY SLB HAL MPC VLO PSX DVN", XLU: "NEE VST CEG SO DUK NRG TLN AEP D EXC GEV", URA: "CCJ UEC LEU OKLO SMR NNE BWXT UUUU DNN",
  XLV: "LLY UNH JNJ ABBV MRK PFE TMO ABT ISRG AMGN BSX NVO", XBI: "VRTX REGN MRNA GILD CRSP BNTX ALNY EXEL INCY NTRA HIMS",
  XLI: "GE CAT HON DE UNP UPS ETN PH EMR FDX WM VRT", ITA: "LMT RTX NOC GD BA LHX HWM TDG AXON KTOS RKLB",
  XLY: "AMZN TSLA HD MCD NKE SBUX LOW BKNG TJX CMG ABNB UBER", XLP: "WMT COST PG KO PEP PM MO CL MDLZ TGT KR",
  XLB: "LIN SHW FCX NEM APD ECL NUE DOW ALB MP", XLRE: "PLD AMT EQIX WELL SPG O PSA DLR CCI", GDX: "NEM B AEM FNV WPM KGC AU GFI PAAS",
  TAN: "FSLR ENPH NXT RUN SEDG CSIQ JKS ARRY", IBIT: "COIN MSTR HOOD MARA RIOT CLSK IREN CIFR GLXY", ARKK: "TSLA COIN ROKU PLTR HOOD SHOP RBLX CRSP TEM"
};
function getSectorStocks(token, etf) {
  if (!isRegistered(token)) return {ok: false};
  etf = String(etf || "").toUpperCase();
  if (!SECTOR_STOCKS[etf]) return {ok: false, msg: "업종을 찾지 못했어요"};
  var cache = CacheService.getScriptCache(), ck = "secst_" + etf, hit = cache.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var syms = SECTOR_STOCKS[etf].split(" "), resps;
  try {
    resps = UrlFetchApp.fetchAll(syms.map(function (s) {
      return {url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=6mo&interval=1d", muteHttpExceptions: true};
    }));
  } catch (e) { return {ok: false, msg: "종목 데이터를 불러오지 못했어요"}; }
  var rows = [];
  syms.forEach(function (s, i) {
    try {
      if (resps[i].getResponseCode() !== 200) return;
      var res = JSON.parse(resps[i].getContentText()).chart.result[0];
      var c = res.indicators.quote[0].close.filter(function (v) { return v != null; }), n = c.length;
      if (n < 70) return;
      var r = function (k) { return Number(((c[n - 1] / c[n - 1 - k] - 1) * 100).toFixed(1)); };
      rows.push({s: s, n: String(res.meta.shortName || res.meta.longName || s).slice(0, 22), p: Number(c[n - 1].toFixed(2)), w1: r(5), m1: r(21), m3: r(63)});
    } catch (err) {}
  });
  if (!rows.length) return {ok: false, msg: "종목 데이터를 불러오지 못했어요"};
  var out = {ok: true, etf: etf, rows: rows};
  try { cache.put(ck, JSON.stringify(out), 1800); } catch (e) {}
  return out;
}
