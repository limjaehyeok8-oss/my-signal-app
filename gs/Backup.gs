// ===== Backup.gs : 하루 한 번 자동 백업 (실수로 지워져도 되돌릴 수 있게) =====
// 1) 아래 setupBackupTrigger 를 한 번만 실행하세요. (매일 새벽 4시쯤 자동 백업)
// 2) 백업은 "자동백업_요일" 탭 7개에 돌려가며 저장돼요 (7일치 유지).
var BACKUP_SHEETS = ["tokens", "holdings", "profiles"];

function dailyBackup() {
  var ss = getSheet().getParent();
  var day = ["일", "월", "화", "수", "목", "금", "토"][new Date(Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy/MM/dd")).getDay()];
  BACKUP_SHEETS.forEach(function (name) {
    var src = ss.getSheetByName(name);
    if (!src) return;
    var bname = "자동백업_" + name + "_" + day, old = ss.getSheetByName(bname);
    if (old) ss.deleteSheet(old);
    var cp = src.copyTo(ss);
    cp.setName(bname);
    cp.hideSheet();                                      // 탭이 지저분해지지 않게 숨김 (보기 > 숨겨진 시트)
  });
}

function setupBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "dailyBackup") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("dailyBackup").timeBased().everyDays(1).atHour(4).create();
  dailyBackup();
  Logger.log("매일 새벽 4시 자동 백업 설정 완료 (지금 한 번 백업도 했어요)");
}