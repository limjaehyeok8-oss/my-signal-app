// ==========================================================
// AlertLog.gs — 보낸 알림 기록 (알림을 실수로 지워도 앱에서 다시 볼 수 있게)
// "alerts" 시트에 [시간, 토큰, 제목, 내용]을 쌓고, 앱이 최근 것을 읽어가요.
//
// Code.gs 의 sendToToken 함수 맨 윗줄에 아래 한 줄을 추가하세요:
//   try { logAlert(token, title, body); } catch (e) {}
// ==========================================================
var ALERTS_SHEET = "alerts";

function getAlertsSheet() {
  var ss = getSheet().getParent();
  var sh = ss.getSheetByName(ALERTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ALERTS_SHEET);
    sh.appendRow(["time", "token", "title", "body"]);
  }
  return sh;
}

function logAlert(token, title, body) {
  var sh = getAlertsSheet();
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
  sh.appendRow([now, token, String(title || ""), String(body || "")]);
  // 너무 쌓이면 오래된 것부터 정리 (600줄 넘으면 앞 200줄 삭제)
  if (sh.getLastRow() > 600) sh.deleteRows(2, 200);
}

// 내 알림만 최근 순으로
function getAlertLog(token, limit) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  limit = Math.max(1, Math.min(50, Number(limit) || 20));
  var sh = getAlertsSheet();
  var last = sh.getLastRow();
  if (last < 2) return {ok: true, alerts: []};
  var from = Math.max(2, last - 299);
  var rows = sh.getRange(from, 1, last - from + 1, 4).getValues();
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    if (rows[i][1] === token) out.push({t: String(rows[i][0]), title: String(rows[i][2]), body: String(rows[i][3])});
  }
  return {ok: true, alerts: out};
}

// ===== 발송 점검 기록 ("runLog" 시트): 개장 전·마감 후 알림이 돌 때마다 무엇을 했는지(건너뜀 이유 포함) 한 줄씩 남김 =====
function runLog(fn, note) {
  try {
    var ss = getSheet().getParent(), sh = ss.getSheetByName("runLog");
    if (!sh) { sh = ss.insertSheet("runLog"); sh.appendRow(["time", "function", "note"]); }
    sh.appendRow([Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"), fn, String(note || "")]);
    if (sh.getLastRow() > 400) sh.deleteRows(2, 150);
  } catch (e) {}
}
