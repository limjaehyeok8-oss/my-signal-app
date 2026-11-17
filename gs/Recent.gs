// ===== Recent.gs : 📋 최근 N일(기본 3일) 신호 다시 받기 =====
// 내 종목·관심 종목의 최근 며칠 동안 일반 매수·매도 신호(하이킨아시 반전)를 모아서 알림으로 한 번 보내고, 목록도 돌려줌.
// 알림을 놓쳤거나 늦게 등록했을 때 쓰는 용도. 1분에 한 번만 가능.
function sendRecentSignals(token, days) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  days = Math.max(1, Math.min(5, Number(days) || 3));
  var me = _dev(token), cache = CacheService.getScriptCache(), ck = "recent_" + me;
  if (cache.get(ck)) return {ok: false, msg: "방금 보냈어요. 1분 뒤에 다시 눌러 주세요"};
  cache.put(ck, "1", 60);

  var syms = [], seen = {};
  var add = function (s, w) { s = String(s || "").trim().toUpperCase(); if (s && !seen[s]) { seen[s] = 1; syms.push({s: s, watch: w}); } };
  var hs = getHoldingsSheet(), hl = hs.getLastRow();
  if (hl >= 2) hs.getRange(2, 1, hl - 1, 2).getValues().forEach(function (r) { if (r[0] && _dev(r[0]) === me) add(r[1], false); });
  try { _watchRows().forEach(function (r) { if (r[0] && r[1] && _dev(r[0]) === me) add(r[1], true); }); } catch (e) {}
  if (!syms.length) return {ok: false, msg: "내 종목이나 관심 종목이 없어요"};
  syms = syms.slice(0, 40);

  var reqs = syms.map(function (x) { return {url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(x.s) + "?range=2y&interval=1d", muteHttpExceptions: true}; });
  var rs = UrlFetchApp.fetchAll(reqs), lines = [], n = 0, fail = 0;
  var live = (typeof _haSession === "function") && _haSession() === "정규장";
  rs.forEach(function (r, i) {
    try {
      if (r.getResponseCode() !== 200) { fail++; return; }
      var d = processYahooData(JSON.parse(r.getContentText()));
      if (!d || d.closes.length < 60) { fail++; return; }
      var ha = calculateHeikinAshi_GAS(d), fl = haSignalFlags(d, ha), len = d.closes.length, ev = [];
      for (var k = Math.max(1, len - days); k < len; k++) {
        var t = fl.sell[k] ? "🔴 매도" : (fl.buy[k] ? "🟢 매수" : null);
        if (!t) continue;
        var dt = Utilities.formatDate(new Date(d.timestamps[k] * 1000), "America/New_York", "MM/dd");
        ev.push(t + " " + dt + " (" + d.closes[k].toFixed(2) + "$)" + (k === len - 1 && live ? " · 장중 임시" : ""));
      }
      if (ev.length) { n += ev.length; lines.push("🔸 " + syms[i].s + (syms[i].watch ? " 👀관심" : "") + "\n" + ev.join("\n")); }
    } catch (e) { fail++; }
  });
  if (!lines.length) return {ok: true, n: 0, msg: "최근 " + days + "일 동안 신호가 없었어요" + (fail ? " (조회 실패 " + fail + "개)" : "")};
  var body = lines.join("\n\n") + "\n\n※ 날짜는 미국 거래일 기준이에요.";
  sendToToken(token, "📋 최근 " + days + "일 신호 " + n + "건", body);
  return {ok: true, n: n, msg: "최근 " + days + "일 신호 " + n + "건을 보냈어요" + (fail ? " (조회 실패 " + fail + "개)" : "")};
}
