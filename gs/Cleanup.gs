// ===== Cleanup.gs : 같은 폰의 옛 토큰 정리 =====
// - cleanupTokens() : 한 번 실행하면 전체를 정리해요 (실행 전 시트를 "백업_…" 이름으로 복사해둬요)
// - registerToken 에서 mergeDeviceTokens(token) 을 부르면, 앞으로는 새 토큰이 등록될 때마다 자동으로 정리돼요

function cleanupTokens() {
  var ss = getSheet().getParent();
  var stamp = Utilities.formatDate(new Date(), "Asia/Seoul", "MMdd_HHmm");
  [TOKENS_SHEET, HOLDINGS_SHEET, PROFILES_SHEET].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s) s.copyTo(ss).setName("백업_" + n + "_" + stamp);
  });
  var r = _mergeTokens(null);
  Logger.log("정리 끝: 옛 토큰 " + r.removed + "개 정리, 종목 " + r.holdMoved + "개 옮김");
  return r;
}

// 방금 등록한 토큰과 같은 폰의 옛 토큰을 정리 (registerToken 안에서 호출)
function mergeDeviceTokens(token) {
  return _mergeTokens(_dev(token));
}

function _mergeTokens(onlyDev) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tsh = getSheet(), tl = tsh.getLastRow();
    if (tl < 2) return {removed: 0, holdMoved: 0};
    var tc = tsh.getLastColumn();
    var trows = tsh.getRange(2, 1, tl - 1, tc).getValues();
    var keep = {};                                    // dev -> 마지막(가장 최근) 줄 번호
    trows.forEach(function (r, i) { var d = _dev(r[0]); if (!onlyDev || d === onlyDev) keep[d] = i; });
    var map = {}, drop = {}, removed = 0;             // 옛토큰 -> 새토큰
    trows.forEach(function (r, i) {
      var d = _dev(r[0]);
      if (keep[d] === undefined || keep[d] === i) return;
      map[String(r[0])] = String(trows[keep[d]][0]);
      drop[i] = true; removed++;
    });
    if (!removed) return {removed: 0, holdMoved: 0};

    // 1) 보유 종목: 토큰을 새 토큰으로 바꾸고, 같은 종목이 겹치면 나중 것만 남김
    var hsh = getHoldingsSheet(), hl = hsh.getLastRow(), holdMoved = 0;
    if (hl >= 2) {
      var hc = hsh.getLastColumn();
      var hrows = hsh.getRange(2, 1, hl - 1, hc).getValues();
      hrows.forEach(function (r) { var n = map[String(r[0])]; if (n) { r[0] = n; holdMoved++; } });
      var lastOf = {};
      hrows.forEach(function (r, i) { lastOf[r[0] + "|" + r[1]] = i; });
      var hout = hrows.filter(function (r, i) { return lastOf[r[0] + "|" + r[1]] === i; });
      hsh.getRange(2, 1, hl - 1, hc).clearContent();
      if (hout.length) hsh.getRange(2, 1, hout.length, hc).setValues(hout);
    }

    // 2) 프로필: 같은 폰은 한 줄로 합치고 닉네임·코드는 유지
    var psh = getProfilesSheet(), pl = psh.getLastRow();
    if (pl >= 2) {
      var prows = psh.getRange(2, 1, pl - 1, 5).getValues();
      var groups = {}, order = [];
      prows.forEach(function (r) {
        var d = _dev(r[0]);
        if (!groups[d]) { groups[d] = []; order.push(d); }
        groups[d].push(r);
      });
      var pout = [];
      order.forEach(function (d) {
        var g = groups[d];
        if (keep[d] === undefined || g.length === 1 && !map[String(g[0][0])]) { g.forEach(function (r) { pout.push(r); }); return; }
        var nick = "", last = g[g.length - 1];
        g.forEach(function (r) { if (r[2]) nick = r[2]; });
        pout.push([String(trows[keep[d]][0]), last[1], nick, last[3], last[4]]);
      });
      psh.getRange(2, 1, pl - 1, 5).clearContent();
      if (pout.length) psh.getRange(2, 1, pout.length, 5).setValues(pout);
    }

    // 3) 받은 알림 기록: 새 토큰으로 이어붙임
    try {
      var ash = getAlertsSheet(), al = ash.getLastRow();
      if (al >= 2) {
        var av = ash.getRange(2, 2, al - 1, 1).getValues().map(function (r) { return [map[String(r[0])] || r[0]]; });
        ash.getRange(2, 2, al - 1, 1).setValues(av);
      }
    } catch (e) {}

    // 4) 토큰 목록: 옛 줄 삭제
    var tout = trows.filter(function (r, i) { return !drop[i]; });
    tsh.getRange(2, 1, tl - 1, tc).clearContent();
    if (tout.length) tsh.getRange(2, 1, tout.length, tc).setValues(tout);
    return {removed: removed, holdMoved: holdMoved};
  } finally {
    lock.releaseLock();
  }
}