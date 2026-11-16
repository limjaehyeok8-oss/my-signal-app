// ===== Account.gs : 탈퇴 (이 기기의 모든 정보 삭제) =====
// 지우는 것: 알림 등록, 보유 종목, 관심 종목, 가격 알림, 프로필(닉네임·사진), 친구 연결, 알림 기록
// 커뮤니티 글·댓글은 내용을 비우고 삭제 처리해요. 되돌릴 수 없어요.
function deleteAccount(token, confirm) {
  if (!isRegistered(token)) return {ok: false, msg: "등록된 기기가 아니에요"};
  if (String(confirm) !== "탈퇴") return {ok: false, msg: "확인 문구가 맞지 않아요"};
  var me = _dev(token), ss = getSheet().getParent(), done = {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    // [시트 이름, 토큰이 들어 있는 칸(0부터)…]
    [["holdings", 0], ["watch", 0], ["holdAlert", 0], ["profiles", 0], ["links", 0, 1], ["alerts", 1], ["tokens", 0]].forEach(function (def) {
      var sh = ss.getSheetByName(def[0]); if (!sh) return;
      var last = sh.getLastRow(); if (last < 2) return;
      var vals = sh.getRange(2, 1, last - 1, Math.max(sh.getLastColumn(), 2)).getValues(), n = 0;
      for (var i = vals.length - 1; i >= 0; i--) {
        var hit = false;
        for (var k = 1; k < def.length; k++) { var v = vals[i][def[k]]; if (v && _dev(v) === me) hit = true; }
        if (hit) { sh.deleteRow(i + 2); n++; }
      }
      done[def[0]] = n;
    });
    // 커뮤니티: 내 글·댓글은 내용을 비우고 삭제 표시
    [["posts", 2, 6, [5, 7]], ["comments", 3, 6, [5]]].forEach(function (def) {
      var sh = ss.getSheetByName(def[0]); if (!sh) return;
      var last = sh.getLastRow(); if (last < 2) return;
      var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues(), n = 0;
      vals.forEach(function (r, i) {
        if (!r[def[1]] || _dev(r[def[1]]) !== me) return;
        sh.getRange(i + 2, def[2]).setValue(1);
        def[3].forEach(function (c) { if (c <= sh.getLastColumn()) sh.getRange(i + 2, c).setValue(""); });
        n++;
      });
      done[def[0]] = n;
    });
  } finally { lock.releaseLock(); }
  try { CacheService.getScriptCache().removeAll(["photos_v1"]); } catch (e) {}
  return {ok: true, msg: "탈퇴가 끝났어요. 이 기기의 정보를 모두 지웠어요.", done: done};
}
