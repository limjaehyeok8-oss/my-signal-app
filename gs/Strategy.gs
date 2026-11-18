// ==========================================================
// Strategy.gs - 종목별 "알림 전략" 저장 / 전략 기준 알림 계산
// holdings 시트의 5번째 칸(E열)에 전략 키를 저장해요. (없으면 기본)
// Code.gs의 doPost에 아래 두 줄을 "알 수 없는 action" 반환 줄 바로 위에 추가하세요:
//   var ex = handleExtra(data);
//   if (ex) return json(ex);
// ==========================================================
var STRATEGY_KEYS = ["default", "base", "side", "cl1", "cl2", "cl3", "cl4", "cl5", "cl6", "cl7", "wha", "w1234", "ma200", "hold1", "holdAll", "holdStrong"];

// 새 기능용 action 모음 (doPost에서 한 번에 연결)
function handleExtra(data) {
  var token = data.token;
  if (data.action === "backtest")      return backtestForWeb(token, data.ticker, data.years);
  if (data.action === "setStrategy")   return setStrategy(token, data.symbol, data.strategy);
  if (data.action === "getStrategies") return getStrategies(token);
  if (data.action === "getFriendInfo") return getFriendInfo(token);
  if (data.action === "setNickname")   return setNickname(token, data.name);
  if (data.action === "analyzeFast")   return analyzeFastWeb(token, data.ticker);
  if (data.action === "setPhoto")      return setPhoto(token, data.photo);
  if (data.action === "getPhotos")     return getPhotos(token);
  if (data.action === "setShowAvg")    return setShowAvg(token, data.show === true);
  if (data.action === "joinRoom")      return joinRoom(token, data.key);
  if (data.action === "setHidden")     return setHidden(token, data.symbol, data.hidden === true);
  if (data.action === "friendHoldings") return friendHoldings(token);
  if (data.action === "getPicks")      return getPicks(token, data.force === true);
  if (data.action === "friendStates")  return friendStates(token);
  if (data.action === "holdingStates") return holdingStates(token);
  if (data.action === "getPosts")      return getPosts(token, data.ticker, data.cat);
  if (data.action === "getComments")   return getComments(token, data.postId);
  if (data.action === "addPost")       return addPost(token, data.text, data.ticker, data.image, data.cat);
  if (data.action === "addComment")    return addComment(token, data.postId, data.text);
  if (data.action === "getExtPrices")  return getExtPrices(token, data.symbols);
  if (data.action === "getHeat")       return getHeat(token, data.symbols);
  if (data.action === "getFund")       return getFund(token, data.symbol);
  if (data.action === "getSectors")    return getSectors(token);
  if (data.action === "getSectorStocks") return getSectorStocks(token, data.etf);
  if (data.action === "deleteAccount") return deleteAccount(token, data.confirm);
  if (data.action === "getOversold")   return getOversold(token, data.symbol);
  if (data.action === "getHoldAlerts") return getHoldAlerts(token);
  if (data.action === "setHoldAlert")  return setHoldAlert(token, data.symbol, data.target, data.stop);
  if (data.action === "getBbAlerts")   return getBbAlerts(token);
  if (data.action === "setBbAlert")    return setBbAlert(token, data.symbol, data.on, data.kind);
  if (data.action === "getBbChart")    return getBbChart(token, data.symbol, data.kind);
  if (data.action === "getWatch")      return getWatch(token);
  if (data.action === "addWatch")      return addWatch(token, data.symbol, data.target);
  if (data.action === "removeWatch")   return removeWatch(token, data.symbol);
  if (data.action === "getMarket")     return getMarket(token);
  if (data.action === "getCoins")      return getCoins(token);
  if (data.action === "getCoinMarkets") return getCoinMarkets(token);
  if (data.action === "getCoinDetail") return getCoinDetail(token, data.sym);
  if (data.action === "getBot")        return getBot(token);
  if (data.action === "getPostImage")  return getPostImage(token, data.id);
  if (data.action === "notifyComm")    return notifyComm(token, data.id);
  if (data.action === "deletePost")    return deletePost(token, data.id);
  if (data.action === "deleteComment") return deleteComment(token, data.id);
  if (data.action === "getAlerts")     return getAlertLog(token, data.limit);
  if (data.action === "sendRecentSignals") return sendRecentSignals(token, data.days);
  return null;
}

function setStrategy(token, symbol, key) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  symbol = String(symbol || "").trim().toUpperCase();
  key = String(key || "default");
  if (STRATEGY_KEYS.indexOf(key) === -1) return {ok: false, msg: "알 수 없는 전략이에요"};

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getHoldingsSheet();
    var last = sh.getLastRow();
    if (last < 2) return {ok: false, msg: symbol + "은(는) 내 보유 종목에 없어요. 먼저 '보유 종목 등록'에서 추가하세요."};
    var rows = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (_dev(rows[i][0]) === _dev(token) && rows[i][1] === symbol) {
        if (!sh.getRange(1, 5).getValue()) sh.getRange(1, 5).setValue("strategy");
        sh.getRange(i + 2, 5).setValue(key === "default" ? "" : key);
        return {ok: true, msg: symbol + " 알림 전략을 저장했어요", strategy: key};
      }
    }
    return {ok: false, msg: symbol + "은(는) 내 보유 종목에 없어요. 먼저 '보유 종목 등록'에서 추가하세요."};
  } finally {
    lock.releaseLock();
  }
}

function getStrategies(token) {
  var sh = getHoldingsSheet();
  var last = sh.getLastRow();
  var map = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 5).getValues().forEach(function (r) {
      if (_dev(r[0]) === _dev(token) && r[1]) map[r[1]] = r[4] ? String(r[4]) : "default";
    });
  }
  return {ok: true, map: map};
}

// 선택한 전략으로 "오늘 사거나 파는 날인지" 계산 (pmPrice가 있으면 프리장 가격을 오늘 봉으로 사용)
function strategyEvents(symbol, key, pmPrice, etDate) {
  var url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=5y&interval=1d";
  var resp = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
  if (resp.getResponseCode() !== 200) return null;
  var d = processYahooData(JSON.parse(resp.getContentText()));
  if (!d || d.closes.length < 100) return null;

  if (pmPrice != null) {
    var li = d.timestamps.length - 1;
    if (Utilities.formatDate(new Date(d.timestamps[li] * 1000), "America/New_York", "yyyy-MM-dd") === etDate) {
      ["opens", "closes", "highs", "lows", "volumes", "dates", "timestamps"].forEach(function (k) { d[k].pop(); });
    }
    var prev = d.closes[d.closes.length - 1];
    d.opens.push(prev); d.closes.push(pmPrice);
    d.highs.push(Math.max(prev, pmPrice)); d.lows.push(Math.min(prev, pmPrice));
    d.volumes.push(0); d.dates.push("pre"); d.timestamps.push(Math.floor(Date.now() / 1000));
  }

  var n = d.closes.length;
  var start = Math.max(60, n - 756);
  var lastRel = n - 1 - start;
  var p = btPrepare(d, symbol);
  var defs = btDefs(p);

  var res = null, short = "", isClover = false, name = "";
  for (var i = 0; i < defs.sims.length; i++) {
    if (defs.sims[i].key === key) {
      res = btSimulate(d, start, defs.sims[i]);
      short = defs.sims[i].short; name = defs.sims[i].name; isClover = !!defs.sims[i].clover;
    }
  }
  if (!res) {
    for (var j = 0; j < defs.holds.length; j++) {
      var h = defs.holds[j];
      if (h.key === key) {
        res = btHoldSim(d, start, h.enter, h.addMore, h.key, h.short, h.name, h.desc);
        short = h.short; name = h.name; isClover = true;
      }
    }
  }
  if (!res) return null;

  var bought = res.trades.some(function (t) { return t.i === lastRel; });
  var soldTrade = res.trades.filter(function (t) { return !t.open && t.o === lastRel; })[0];
  return {bought: bought, sold: !!soldTrade, why: soldTrade ? soldTrade.why : "", short: short, name: name, isClover: isClover, hold: !!res.hold};
}

// 기본 알림 목록을, 선택한 전략 기준으로 바꿈 (장기손절가·초고점 경고는 그대로 유지)
function applyStrategy(symbol, key, baseAlerts, pmPrice, etDate) {
  if (!key || key === "default") return baseAlerts;
  var ev;
  try { ev = strategyEvents(symbol, key, pmPrice, etDate); } catch (e) { ev = null; }
  if (!ev) return baseAlerts;

  var out = (baseAlerts || []).filter(function (a) {
    return a.indexOf("장기손절가") !== -1 || a.indexOf("초고점") !== -1;
  });
  if (ev.bought) out.push((ev.isClover ? "☘️ 저점매수 신호" : "🟢 매수 신호") + (ev.hold ? " (사 모으기)" : "") + " · 전략 " + ev.short);
  if (ev.sold) out.push("🔴 매도 신호 · 전략 " + ev.short + " (" + ev.why + ")");
  if (out.length) out.push("ℹ️ 이 종목은 '" + ev.short + "' 전략으로 알림 중");
  return out;
}

// ==========================================================
// 고른 전략을 5년치 데이터로 돌려 결과를 돌려줌 (같은 실행 안에서는 캐시해서 두 번 안 받음)
// ==========================================================
var _stratRunCache = {};
function _strategyRun(ticker, key) {
  var ck = ticker + "|" + key;
  if (_stratRunCache[ck] !== undefined) return _stratRunCache[ck];
  var out = null;
  try {
    var url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker) + "?range=5y&interval=1d";
    var resp = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
    if (resp.getResponseCode() === 200) {
      var d = processYahooData(JSON.parse(resp.getContentText()));
      if (d && d.closes.length >= 100) {
        var n = d.closes.length;
        var start = Math.max(60, n - 1260);
        var p = btPrepare(d, ticker);
        var defs = btDefs(p);
        var res = null, name = "", short = "";
        for (var i = 0; i < defs.sims.length; i++) {
          if (defs.sims[i].key === key) { res = btSimulate(d, start, defs.sims[i]); name = defs.sims[i].name; short = defs.sims[i].short; }
        }
        if (!res) {
          for (var j = 0; j < defs.holds.length; j++) {
            var h = defs.holds[j];
            if (h.key === key) { res = btHoldSim(d, start, h.enter, h.addMore, h.key, h.short, h.name, h.desc); name = h.name; short = h.short; }
          }
        }
        if (res) out = {d: d, n: n, start: start, res: res, name: name, short: short};
      }
    }
  } catch (e) { out = null; }
  _stratRunCache[ck] = out;
  return out;
}

// 분석 차트의 🟢(매수) 🔴(매도) 표시를, 고른 전략 기준으로 바꿔 줌
// fullBuy / fullSell : 분석 차트가 쓰는 배열(dData와 같은 길이). 여기서 직접 덮어씀.
// 반환: 적용한 전략 이름(없으면 "")
function applyStrategyToMarkers(dData, ticker, key, fullBuy, fullSell) {
  if (!key || key === "default") return "";
  var r = _strategyRun(ticker, key);
  if (!r) return "";
  var buyDates = {}, sellDates = {};
  r.res.trades.forEach(function (t) {
    buyDates[t.inDate] = true;
    if (!t.open) sellDates[t.outDate] = true;
  });
  for (var k = 0; k < fullBuy.length; k++) {
    var ds = btDate(dData.timestamps[k]);
    fullBuy[k] = !!buyDates[ds];
    fullSell[k] = !!sellDates[ds];
  }
  return r.name;
}

// "🤖 봇 상태" 문구를 고른 전략 기준으로 만듦. 기본이거나 계산 실패면 null (→ 기존 상태 그대로 사용)
function getStrategyState(ticker, key) {
  if (!key || key === "default") return null;
  var r = _strategyRun(ticker, key);
  if (!r) return null;
  var d = r.d, last = r.n - 1, cp = d.closes[last];
  var trades = r.res.trades;
  var tag = "전략: " + r.short;
  if (!trades.length) {
    return {type: "none", days: 0, strategy: r.short, short: "⚪ 신호 없음 (" + r.short + ")",
            text: "⚪ 이 전략 신호 아직 없음\n• " + tag};
  }
  var lastTrade = trades[trades.length - 1];
  var type, idx, sigPrice, head, notes = [];
  if (lastTrade.open) {
    type = "buy"; idx = lastTrade.i + r.start; sigPrice = lastTrade.inPx;
    head = r.res.hold ? "🟢 사서 보유 중" : "🟢 마지막 신호: 매수";
    notes.push(r.res.hold ? "이 전략은 안 팔고 보유" : "매도 신호는 아직 없어요");
  } else {
    type = "sell"; idx = lastTrade.o + r.start; sigPrice = lastTrade.outPx;
    head = "🔴 마지막 신호: 매도 (" + lastTrade.why + ")";
    notes.push("새 매수 신호는 아직 없어요");
  }
  notes.push(tag);
  var days = last - idx;
  var chg = (cp / sigPrice - 1) * 100;
  var chgTxt = (chg >= 0 ? "+" : "") + chg.toFixed(1) + "%";
  return {
    type: type, days: days, strategy: r.short,
    short: (type === "buy" ? "🟢 매수 진행중 " : "🔴 매도 진행중 ") + (days === 0 ? "오늘" : days + "일째") + " (" + chgTxt + ")",
    text: _stateText(head, days, btDate(d.timestamps[idx]).slice(5), sigPrice, cp, notes)
  };
}


// ---- 속도: 여러 종목을 한 번에(병렬) 가져오고, 가격·상태는 잠깐 기억해 둠 ----
function _cachedPrices(syms) {
  var cache = CacheService.getScriptCache(), out = {}, need = [];
  var hit = {};
  try { hit = cache.getAll(syms.map(function (s) { return "px_" + s; })); } catch (e) {}
  syms.forEach(function (s) {
    var v = hit["px_" + s];
    if (v !== undefined && v !== null && v !== "") out[s] = Number(v); else need.push(s);
  });
  if (need.length) {
    var got = fetchPrices(need), put = {};
    need.forEach(function (s) { out[s] = got[s]; if (got[s] != null) put["px_" + s] = String(got[s]); });
    try { cache.putAll(put, 120); } catch (e) {}
  }
  return out;
}

function _badgeFromState(st) {
  if (!st) return "⚪ 신호 없음";
  var days = st.days === 0 ? "오늘" : st.days + "일째";
  return st.type === "buy" ? "▲ 매수 유지 " + days
       : st.type === "sell" ? "❗ 매도 유지 " + days
       : st.type === "clover" ? "☘️ 저점매수 " + days
       : "⚪ 신호 없음";
}

// 기본 전략 기준 상태 뱃지 (종목별 20분 캐시, 안 캐시된 것만 한꺼번에 가져옴)
function _defaultBadges(syms) {
  var cache = CacheService.getScriptCache(), out = {}, need = [], hit = {};
  try { hit = cache.getAll(syms.map(function (s) { return "fst_" + s; })); } catch (e) {}
  syms.forEach(function (s) { if (hit["fst_" + s]) out[s] = hit["fst_" + s]; else need.push(s); });
  if (need.length) {
    var reqs = need.map(function (s) {
      return {url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=1y&interval=1d", muteHttpExceptions: true};
    });
    var resps = [];
    try { resps = UrlFetchApp.fetchAll(reqs); } catch (e) {}
    var put = {};
    need.forEach(function (s, i) {
      var b = "⚪ 신호 없음";
      try {
        var r = resps[i];
        if (r && r.getResponseCode() === 200) {
          var d = processYahooData(JSON.parse(r.getContentText()));
          if (d && d.closes.length >= 60) b = _badgeFromState(getSignalState(d, calculateHeikinAshi_GAS(d)));
        }
      } catch (e) {}
      out[s] = b; put["fst_" + s] = b;
    });
    try { cache.putAll(put, 1200); } catch (e) {}
  }
  return out;
}

// 내 보유 종목마다 "지금 매수 유지 / 매도 유지 / 저점매수" 한 줄 상태 (내가 고른 전략 기준)
function holdingStates(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var sh = getHoldingsSheet(), last = sh.getLastRow(), mine = [];
  if (last >= 2) sh.getRange(2, 1, last - 1, 5).getValues().forEach(function (r) {
    if (_dev(r[0]) === _dev(token) && r[1]) mine.push({s: String(r[1]), key: r[4] ? String(r[4]) : "default"});
  });
  var out = {}, defs = [];
  mine.forEach(function (h) { if (h.key === "default") defs.push(h.s); });
  var db = defs.length ? _defaultBadges(defs) : {};
  mine.forEach(function (h) {
    try {
      if (h.key === "default") out[h.s] = {b: db[h.s] || "⚪ 신호 없음", t: ""};
      else out[h.s] = {b: _badgeFromState(getStrategyState(h.s, h.key)), t: ""};
    } catch (e) { out[h.s] = {b: "⚪ 확인 못함", t: "none"}; }
  });
  return {ok: true, map: out};
}

// 친구 종목들의 상태 (종목마다 기본 전략 기준)
function friendStates(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var isF = {}; _friendDevs(token).forEach(function (d) { isF[d] = true; });
  var hs = getHoldingsSheet(), last = hs.getLastRow(), syms = {};
  if (last >= 2) hs.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    if (isF[_dev(r[0])] && r[1]) syms[String(r[1])] = true;
  });
  return {ok: true, map: _defaultBadges(Object.keys(syms))};
}


// ===== 종목 분석 빠르게: 글 먼저(차트 없이) + 결과 잠깐 저장 =====
function _okTicker(ticker) {
  ticker = String(ticker || "").trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,10}$/.test(ticker) ? ticker : "";
}
// 차트 없이 분석 글만 (1~2초). 5분 저장.
function analyzeFastWeb(token, ticker) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var t = _okTicker(ticker);
  if (!t) return {ok: false, msg: "티커 형식이 올바르지 않아요"};
  var c = CacheService.getScriptCache(), k = "ans_" + t;
  var hit = c.get(k);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var r;
  try { r = analyzeStock(t, true); } catch (e) { return {ok: false, msg: t + " 분석 중 오류: " + e.message}; }
  var out = r && r.ok ? {ok: true, text: r.text} : {ok: false, msg: (r && r.msg) || "분석에 실패했어요"};
  if (out.ok) { try { c.put(k, JSON.stringify(out), 300); } catch (e) {} }
  return out;
}
// 차트 포함 전체 분석 (Code.gs 의 analyze 가 이걸 불러요). 5분 저장.
var _CHART_CB = false, _CHART_WHITE = false;      // 색약 팔레트 / 흰 배경으로 차트를 그릴지 (analyzeCachedWeb 이 잠깐 켬)
function analyzeCachedWeb(token, ticker, cb, wb) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var t = _okTicker(ticker);
  if (!t) return {ok: false, msg: "티커 형식이 올바르지 않아요"};
  var c = CacheService.getScriptCache(), k = "anf_" + t + (cb ? "_cb" : "") + (wb ? "_wb" : "");
  var hit = c.get(k);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  _CHART_CB = !!cb; _CHART_WHITE = !!wb;
  var r;
  try { r = analyzeForWeb(token, t); } finally { _CHART_CB = false; _CHART_WHITE = false; }
  if (r && r.ok && r.image) { try { var js = JSON.stringify(r); if (js.length < 95000) c.put(k, js, 300); } catch (e) {} }   // 차트가 없는 응답은 캐시하지 않음(실패가 5분간 굳지 않게)
  return r;
}