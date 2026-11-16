// ===== HoldAlert.gs : 🎯 보유 종목 목표가·손절가 알림 =====
// 관심 종목 목표가와 같은 10분 확인(checkWatchTargets)에 같이 물려 있어요.
// 시트 "holdAlert": [token, symbol, target, stop, targetFiredAt, stopFiredAt]
var HA_SHEET = "holdAlert";

function _haSheet() {
  var ss = getSheet().getParent(), sh = ss.getSheetByName(HA_SHEET);
  if (!sh) { sh = ss.insertSheet(HA_SHEET); sh.getRange(1, 1, 1, 6).setValues([["token", "symbol", "target", "stop", "targetFiredAt", "stopFiredAt"]]); }
  return sh;
}
function _haRows() {
  var sh = _haSheet(), last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, 6).getValues();
}

function getHoldAlerts(token) {
  if (!isRegistered(token)) return {ok: false};
  var me = _dev(token), map = {};
  _haRows().forEach(function (r) {
    if (!r[0] || !r[1] || _dev(r[0]) !== me) return;
    map[String(r[1])] = {t: Number(r[2]) || null, s: Number(r[3]) || null, tf: !!r[4], sf: !!r[5]};
  });
  return {ok: true, map: map};
}

function setHoldAlert(token, symbol, target, stop) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  symbol = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return {ok: false, msg: "티커를 확인하세요"};
  target = Number(target) || 0; stop = Number(stop) || 0;
  if (target < 0 || stop < 0) return {ok: false, msg: "가격을 확인하세요"};
  if (target && stop && stop >= target) return {ok: false, msg: "손절가는 목표가보다 낮아야 해요"};
  if (target || stop) {
    var p = null;
    try { p = fetchPrices([symbol])[symbol]; } catch (e) {}
    if (p != null) {
      if (target && target <= p) return {ok: false, msg: "목표가는 현재가($" + Number(p).toFixed(2) + ")보다 높아야 해요"};
      if (stop && stop >= p) return {ok: false, msg: "손절가는 현재가($" + Number(p).toFixed(2) + ")보다 낮아야 해요"};
    }
  }
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var sh = _haSheet(), rows = _haRows(), me = _dev(token);
    for (var i = rows.length - 1; i >= 0; i--) {
      if (rows[i][0] && _dev(rows[i][0]) === me && String(rows[i][1]) === symbol) sh.deleteRow(i + 2);
    }
    if (target || stop) sh.appendRow([token, symbol, target || "", stop || "", "", ""]);
  } finally { lock.releaseLock(); }
  if (!target && !stop) return {ok: true, msg: symbol + " 가격 알림을 껐어요"};
  return {ok: true, msg: symbol + " 저장됨 ·" + (target ? " 목표 $" + target : "") + (stop ? " 손절 $" + stop : "")};
}

// 10분마다(장중): 목표가·손절가에 닿으면 각각 한 번만 알림
function checkHoldAlerts() {
  var sh = _haSheet(), rows = _haRows(), todo = [], set = {};
  rows.forEach(function (r, i) {
    if (!r[0] || !r[1]) return;
    if ((Number(r[2]) > 0 && !r[4]) || (Number(r[3]) > 0 && !r[5])) { todo.push(i); set[String(r[1])] = 1; }
  });
  if (!todo.length) return "대기 중인 가격 알림 없음";
  var px = fetchPrices(Object.keys(set)), cur = _watchCurTokens(), sent = 0;
  todo.forEach(function (i) {
    var r = rows[i], s = String(r[1]), t = Number(r[2]), st = Number(r[3]), p = px[s];
    if (p == null) return;
    var c = cur[_dev(r[0])] || {t: String(r[0]), paused: false};
    if (t > 0 && !r[4] && p >= t) {
      sh.getRange(i + 2, 5).setValue(new Date());
      if (!c.paused) { sendToToken(c.t, "🎯 목표가 도달: " + s, s + " 현재 $" + Number(p).toFixed(2) + " · 내 목표 $" + t + "\n(목표가를 다시 저장하면 또 알려드려요)"); sent++; }
    }
    if (st > 0 && !r[5] && p <= st) {
      sh.getRange(i + 2, 6).setValue(new Date());
      if (!c.paused) { sendToToken(c.t, "🛑 손절가 도달: " + s, s + " 현재 $" + Number(p).toFixed(2) + " · 내 손절가 $" + st + "\n(손절가를 다시 저장하면 또 알려드려요)"); sent++; }
    }
  });
  return "가격 알림 " + sent + "건";
}
