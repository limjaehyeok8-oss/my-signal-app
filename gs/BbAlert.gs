// ===== BbAlert.gs : 📉 볼린저 밴드 하단 터치·이탈 알림 (일봉 / 주봉) =====
// 관심·보유·분석 화면에서 종목별·봉 종류별로 켜고 끄는 알림. 10분마다 확인(checkWatchTargets에 같이 물려 있음).
// 볼린저 밴드 = 20개 봉 평균 ± 2 표준편차. 정규장 중에 이번 봉의 가격(저가 포함)이 하단에 닿거나 내려가면 알려줘요.
// 괴리율 = 현재가가 하단에서 얼마나 벗어났는지(%). 하단 아래면 마이너스.
// 단계 알림: 처음 닿을 때 한 번, 그 뒤 괴리율이 -1%, -2%, -3%… 더 깊어질 때마다 한 번씩. 다시 올라와도 같은 단계는 반복하지 않고,
// 밴드 위로 올라와야 처음부터 다시 시작해요.
// 시트 "bbAlert": [token, symbol, state, firedAt, kind]   state: 0 = 밴드 위, 1 = 터치 알림 보냄, 2 = -1% 알림 보냄, 3 = -2% … (깊이+1) / kind: "d" 일봉(빈칸 포함), "w" 주봉
var BB_SHEET = "bbAlert", BB_N = 20, BB_K = 2, BB_MAX = 40, BB_STEP = 1;
var BB_NAME = {d: "일봉", w: "주봉"};

function _bbSheet() {
  var ss = getSheet().getParent(), sh = ss.getSheetByName(BB_SHEET);
  if (!sh) { sh = ss.insertSheet(BB_SHEET); sh.getRange(1, 1, 1, 5).setValues([["token", "symbol", "state", "firedAt", "kind"]]); }
  return sh;
}
function _bbRows() {
  var sh = _bbSheet(), last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, 5).getValues();
}
function _bbKind(v) { return String(v) === "w" ? "w" : "d"; }

// 내가 켜 둔 종목 → {SYMBOL: {d: 1, w: 1}}
function getBbAlerts(token) {
  if (!isRegistered(token)) return {ok: false};
  var me = _dev(token), map = {};
  _bbRows().forEach(function (r) {
    if (!r[0] || !r[1] || _dev(r[0]) !== me) return;
    var s = String(r[1]).toUpperCase(); map[s] = map[s] || {}; map[s][_bbKind(r[4])] = 1;
  });
  return {ok: true, map: map};
}

// 켜기/끄기 (kind: "d" 일봉 / "w" 주봉). 켤 때는 지금 하단 가격을 같이 알려줘요.
function setBbAlert(token, symbol, on, kind) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  symbol = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return {ok: false, msg: "티커를 확인하세요"};
  kind = _bbKind(kind);
  on = on === true || on === "true" || on === 1 || on === "1";
  var nm = BB_NAME[kind], info = null;
  if (on) {
    try { info = _bbFetch([symbol], kind)[symbol]; } catch (e) {}
    if (!info) return {ok: false, msg: symbol + " 시세를 가져오지 못했어요. 티커를 확인하거나 잠시 후 다시 해 주세요"};
  }
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var sh = _bbSheet(), rows = _bbRows(), me = _dev(token), mine = 0, found = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] && _dev(rows[i][0]) === me) {
        mine++;
        if (String(rows[i][1]).toUpperCase() === symbol && _bbKind(rows[i][4]) === kind) found = i;
      }
    }
    if (!on) {
      if (found >= 0) sh.deleteRow(found + 2);
      return {ok: true, on: false, msg: symbol + " " + nm + " 볼린저 알림을 껐어요"};
    }
    if (found >= 0) return {ok: true, on: true, msg: symbol + " " + nm + " 볼린저 알림이 이미 켜져 있어요"};
    if (mine >= BB_MAX) return {ok: false, msg: "볼린저 알림은 " + BB_MAX + "개까지 켤 수 있어요"};
    var b = _bbBands(info, kind), below = _bbState(b);     // 이미 하단 아래면 지금 단계부터 기록 → 더 깊어질 때부터 알림
    sh.appendRow([token, symbol, below, "", kind]);
    var m = symbol + " " + nm + " 볼린저 하단 알림을 켰어요";
    if (b) m += " · 하단 $" + b.lower.toFixed(2) + " (괴리율 " + _bbGap(b) + ")";
    if (below) m += "\n지금 이미 하단 아래예요. 괴리율이 " + BB_STEP + "%씩 더 깊어질 때마다 알려드려요";
    return {ok: true, on: true, msg: m};
  } finally { lock.releaseLock(); }
}

// 괴리율 글자: 현재가가 하단보다 얼마나 위/아래인지
// 지금 깊이 단계: 0 = 터치(하단 위에서 저가만 닿음 포함), n = 괴리율이 -n×STEP% 이하. 상태값(state)은 깊이+1
function _bbState(b) { if (!b || !b.touch) return 0; var g = (b.px / b.lower - 1) * 100; return 1 + (g < 0 ? Math.floor(-g / BB_STEP) : 0); }
function _bbGap(b) { var g = (b.px / b.lower - 1) * 100; return (g >= 0 ? "+" : "") + g.toFixed(1) + "%"; }

// 일봉(3개월) 또는 주봉(1년) + 현재가. 반환: {SYM: {closes, lows, ts: [초], px: 현재가}}
function _bbFetch(symbols, kind) {
  var out = {};
  if (!symbols.length) return out;
  var qs = _bbKind(kind) === "w" ? "?range=1y&interval=1wk" : "?range=3mo&interval=1d";
  var resps = UrlFetchApp.fetchAll(symbols.map(function (s) {
    return {url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + qs, muteHttpExceptions: true};
  }));
  resps.forEach(function (resp, k) {
    try {
      if (resp.getResponseCode() !== 200) return;
      var r = JSON.parse(resp.getContentText()).chart.result[0], q = r.indicators.quote[0], ts = r.timestamp || [];
      var closes = [], lows = [], tss = [];
      for (var i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        closes.push(Number(q.close[i])); lows.push(q.low[i] == null ? Number(q.close[i]) : Number(q.low[i])); tss.push(ts[i]);
      }
      if (closes.length < BB_N) return;
      var px = Number(r.meta && r.meta.regularMarketPrice);
      out[symbols[k]] = {closes: closes, lows: lows, ts: tss, px: px > 0 ? px : closes[closes.length - 1]};
    } catch (e) {}
  });
  return out;
}

// 밴드 계산. 마지막 봉이 이번 봉(일봉=오늘, 주봉=최근 7일 안)이면 그 종가를 현재가로 바꿔서 계산해요(차트와 같은 방식).
// 반환: {px, ma, lower, upper, low(이번 봉 저가), touch(이번 봉 가격·저가가 하단 이하인지)}
function _bbBands(info, kind) {
  if (!info || !info.closes || info.closes.length < BB_N) return null;
  var c = info.closes.slice(), n = c.length, lastTs = info.ts[n - 1], live;
  if (_bbKind(kind) === "w") live = (Date.now() / 1000 - lastTs) < 7 * 86400;
  else {
    var f = function (t) { return Utilities.formatDate(new Date(t * 1000), "America/New_York", "yyyyMMdd"); };
    live = f(lastTs) === f(Date.now() / 1000);
  }
  if (live && info.px > 0) c[n - 1] = info.px;
  var w = c.slice(n - BB_N), sum = 0, i;
  for (i = 0; i < w.length; i++) sum += w[i];
  var ma = sum / BB_N, v = 0;
  for (i = 0; i < w.length; i++) v += (w[i] - ma) * (w[i] - ma);
  var sd = Math.sqrt(v / BB_N), lower = ma - BB_K * sd, upper = ma + BB_K * sd;
  var px = live && info.px > 0 ? info.px : c[n - 1];
  var low = live ? Math.min(px, info.lows[n - 1]) : px;
  return {px: px, ma: ma, lower: lower, upper: upper, low: low, touch: sd > 0 && low <= lower};
}

// 10분마다: 켜 둔 종목이 볼린저 하단에 닿거나 이탈하면 알림 (정규장에서만)
function checkBbAlerts(force) {
  if (force !== true && _haSession() !== "정규장") return "정규장이 아님";
  var sh = _bbSheet(), rows = _bbRows(), set = {d: {}, w: {}}, any = false;
  rows.forEach(function (r) { if (r[0] && r[1]) { set[_bbKind(r[4])][String(r[1]).toUpperCase()] = 1; any = true; } });
  if (!any) return "볼린저 알림 없음";
  var data = {d: {}, w: {}};
  ["d", "w"].forEach(function (kd) {
    var syms = Object.keys(set[kd]);
    for (var k = 0; k < syms.length; k += 40) {
      var part = {};
      try { part = _bbFetch(syms.slice(k, k + 40), kd); } catch (e) {}
      for (var s0 in part) data[kd][s0] = part[s0];
    }
  });
  var cur = _watchCurTokens(), sent = 0, bands = {d: {}, w: {}};
  rows.forEach(function (r, i) {
    if (!r[0] || !r[1]) return;
    var s = String(r[1]).toUpperCase(), kd = _bbKind(r[4]);
    if (!(s in bands[kd])) bands[kd][s] = _bbBands(data[kd][s], kd);
    var b = bands[kd][s]; if (!b) return;
    var state = Math.max(0, Math.floor(Number(r[2]) || 0)), now = _bbState(b);
    if (now > state) {
      sh.getRange(i + 2, 3).setValue(now); sh.getRange(i + 2, 4).setValue(new Date());
      var c = cur[_dev(r[0])] || {t: String(r[0]), paused: false};
      if (!c.paused) {
        var below = b.px < b.lower, lv = now - 1;
        sendToToken(c.t, "📉 " + BB_NAME[kd] + " 볼린저 하단 " + (lv >= 1 ? "괴리율 -" + (lv * BB_STEP) + "% 돌파: " : below ? "이탈: " : "터치: ") + s,
          s + " 현재 $" + b.px.toFixed(2) + " · " + BB_NAME[kd] + " 하단 $" + b.lower.toFixed(2) + " · 괴리율 " + _bbGap(b) + " (" + BB_NAME[kd] + " 20선 $" + b.ma.toFixed(2) + " 대비 " + ((b.px / b.ma - 1) * 100).toFixed(1) + "%)\n" +
          "많이 빠진 자리예요. 반등할 수도, 더 빠질 수도 있어서 추세 확인 후 판단하세요.");
        sent++;
      }
    } else if (now === 0 && state > 0) {
      sh.getRange(i + 2, 3).setValue(0);                                  // 밴드 위로 올라옴 → 처음부터 다시
    }
  });
  return "볼린저 알림 " + sent + "건";
}

// 직접 확인용: 앱스스크립트에서 실행하면 로그에 하단 가격과 괴리율이 나와요
function testBbAlert() {
  ["AAPL", "XOM", "NVDA"].forEach(function (s) {
    ["d", "w"].forEach(function (kd) {
      var d = _bbFetch([s], kd)[s], b = _bbBands(d, kd);
      Logger.log(s + " " + BB_NAME[kd] + " " + (b ? "현재 " + b.px.toFixed(2) + " · 하단 " + b.lower.toFixed(2) + " · 20선 " + b.ma.toFixed(2) + " · 상단 " + b.upper.toFixed(2) + " · 괴리율 " + _bbGap(b) + " · 닿음 " + b.touch : "데이터 없음"));
    });
  });
}
