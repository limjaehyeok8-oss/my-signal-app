// ===== Community.gs : 글 올리고 댓글 다는 게시판 (등록한 사람 전체가 같은 게시판을 봐요) =====
var POSTS_SHEET = "posts";
var COMMENTS_SHEET = "comments";

function _postsSheet() {
  var sh = _sheet(POSTS_SHEET, ["id", "ts", "token", "ticker", "text", "deleted", "image", "cat", "hasImg"]);
  var c = CacheService.getScriptCache();
  if (!c.get("cm_hdr2")) {
    if (sh.getMaxColumns() < 9) sh.insertColumnsAfter(sh.getMaxColumns(), 9 - sh.getMaxColumns());                                  // 머리글 확인은 가끔만 (매번 하면 느림)
    if (!sh.getRange(1, 7).getValue()) sh.getRange(1, 7).setValue("image");   // 예전 시트에도 사진·분류 칸 추가
    if (!sh.getRange(1, 8).getValue()) sh.getRange(1, 8).setValue("cat");
    if (!sh.getRange(1, 9).getValue()) sh.getRange(1, 9).setValue("hasImg");
    c.put("cm_hdr2", "1", 21600);
  }
  return sh;
}
function _commentsSheet() { return _sheet(COMMENTS_SHEET, ["id", "postId", "ts", "token", "text", "deleted"]); }

function _nameMap() {                      // 기기(한 사람) 기준 이름
  var dn = _devNames(), m = {};
  Object.keys(dn).forEach(function (d) { m[d] = _devLabel(dn[d]); });
  return m;
}
function _fmtTs(ms) { return Utilities.formatDate(new Date(Number(ms)), "Asia/Seoul", "MM/dd HH:mm"); }
function _newId() { return Utilities.getUuid().replace(/-/g, "").slice(0, 12); }
function _tooFast(token, kind, sec) {
  var c = CacheService.getScriptCache(), k = "cm_" + kind + "_" + String(token).slice(-20);
  if (c.get(k)) return true;
  c.put(k, "1", sec);
  return false;
}

var POST_CATS = ["free", "chart", "pick", "ask", "info", "log"];

function getPosts(token, ticker, cat) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  _myProfile(token);                                         // 닉네임 목록에 내가 들어가게
  var names = _nameMap();
  var ps = _postsSheet(), pl = ps.getLastRow(), n = Math.min(pl - 1, 200), start = pl - n + 1;
  var rows = [], cats = [], hi = [];
  if (n > 0) {                                               // 사진 칸(7번)은 읽지 않음 → 목록이 빨리 뜸
    rows = ps.getRange(start, 1, n, 6).getValues();
    cats = ps.getRange(start, 8, n, 2).getValues();          // 분류 + 사진 있음 표시
  }
  var cs = _commentsSheet(), cl = cs.getLastRow(), cnt = {};
  if (cl >= 2) {
    var cp = cs.getRange(2, 2, cl - 1, 1).getValues(), cd = cs.getRange(2, 6, cl - 1, 1).getValues();
    for (var k = 0; k < cp.length; k++) if (!cd[k][0]) cnt[cp[k][0]] = (cnt[cp[k][0]] || 0) + 1;
  }
  ticker = String(ticker || "").trim().toUpperCase();
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < 60; i--) {
    var r = rows[i];
    if (r[5]) continue;
    if (ticker && String(r[3]) !== ticker) continue;
    var rc = String(cats[i][0] || "free");
    if (cat && POST_CATS.indexOf(cat) !== -1 && rc !== cat) continue;
    out.push({id: r[0], time: _fmtTs(r[1]), name: names[_dev(r[2])] || "익명", ticker: String(r[3] || ""),
              text: String(r[4]), hasImg: cats[i][1] === 1, cat: rc, mine: _dev(r[2]) === _dev(token), cc: cnt[r[0]] || 0});
  }
  return {ok: true, posts: out};
}

// 사진은 목록과 따로 가져옴 (글이 먼저 뜨고 사진은 뒤에서 채워짐)
function getPostImage(token, id) {
  if (!isRegistered(token)) return {ok: false};
  var ps = _postsSheet(), pl = ps.getLastRow();
  if (pl < 2) return {ok: false};
  var n = Math.min(pl - 1, 300), start = pl - n + 1, ids = ps.getRange(start, 1, n, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] === id) return {ok: true, image: String(ps.getRange(start + i, 7).getValue() || "")};
  return {ok: false};
}

function getComments(token, postId) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var names = _nameMap(), cs = _commentsSheet(), cl = cs.getLastRow(), out = [];
  if (cl >= 2) cs.getRange(2, 1, cl - 1, 6).getValues().forEach(function (r) {
    if (r[1] === postId && !r[5]) out.push({id: r[0], time: _fmtTs(r[2]), name: names[_dev(r[3])] || "익명", text: String(r[4]), mine: _dev(r[3]) === _dev(token)});
  });
  return {ok: true, comments: out};
}

// 사진은 구글 시트 칸에 작게 줄인 그림 그대로 저장 (드라이브 권한 필요 없음)
function _saveImage(dataUrl) {
  dataUrl = String(dataUrl || "");
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) return null;
  if (dataUrl.length > 49000) return null;                          // 시트 한 칸 한도(5만 자)
  return dataUrl;
}

function addPost(token, text, ticker, image, cat) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  text = String(text || "").trim().slice(0, 500);
  if (!text && !image) return {ok: false, msg: "내용을 적어주세요"};
  ticker = String(ticker || "").trim().toUpperCase();
  if (ticker && !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) ticker = "";
  if (_tooFast(token, "post", 10)) return {ok: false, msg: "잠깐만요, 10초 뒤에 다시 올려주세요"};
  cat = POST_CATS.indexOf(String(cat)) !== -1 ? String(cat) : "free";
  var imgId = "", pid = _newId();
  if (image) {
    try { imgId = _saveImage(image) || ""; } catch (e) { return {ok: false, msg: "사진을 저장하지 못했어요"}; }
    if (!imgId) return {ok: false, msg: "사진이 너무 크거나 형식이 달라요"};
  }
  _postsSheet().appendRow([pid, Date.now(), token, ticker, text, 0, imgId, cat, imgId ? 1 : 0]);
  return {ok: true, id: pid};
}


function addComment(token, postId, text) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  text = String(text || "").trim().slice(0, 300);
  if (!text) return {ok: false, msg: "내용을 적어주세요"};
  if (_tooFast(token, "cmt", 3)) return {ok: false, msg: "잠깐만요, 조금 뒤에 다시 달아주세요"};
  var cid = _newId();
  _commentsSheet().appendRow([cid, String(postId), Date.now(), token, text, 0]);
  return {ok: true, id: cid};
}

function _softDelete(sh, id, token, tokCol, delCol) {
  var last = sh.getLastRow();
  if (last < 2) return {ok: false, msg: "이미 없는 글이에요"};
  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === id) {
      if (_dev(vals[i][tokCol]) !== _dev(token)) return {ok: false, msg: "내 글만 지울 수 있어요"};
      sh.getRange(i + 2, delCol).setValue(1);
      if (sh.getName() === POSTS_SHEET && vals[i][6]) { /* 사진은 시트 칸에 있으므로 글과 같이 처리됨 */ }
      return {ok: true};
    }
  }
  return {ok: false, msg: "이미 없는 글이에요"};
}
function deletePost(token, id) { return isRegistered(token) ? _softDelete(_postsSheet(), String(id), token, 2, 6) : {ok: false}; }
function deleteComment(token, id) { return isRegistered(token) ? _softDelete(_commentsSheet(), String(id), token, 3, 6) : {ok: false}; }


// ===== 새 글/댓글 알림 (다른 사람들에게 푸시, 누르면 커뮤 탭으로 이동) =====
// 테스트용: true면 글/댓글 쓴 본인에게도 알림이 옴 (테스트 끝나면 false로)
var COMM_NOTIFY_SELF = true;
var COMM_LINK = "https://limjaehyeok8-oss.github.io/my-signal-app/#comm";

// 알림을 켠 사람들 (기기당 1개, 쓴 사람 본인 기기는 제외)
function _commTargets(token) {
  var sh = getSheet(), last = sh.getLastRow();
  if (last < 2) return [];
  var me = _dev(token), byDev = {};
  sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) {
    var t = String(r[0]).trim(); if (!t) return;
    byDev[_dev(t)] = {t: t, paused: r[2] === true};          // 같은 기기는 맨 아래(가장 최근) 줄이 이김
  });
  return Object.keys(byDev).filter(function (d) { return (COMM_NOTIFY_SELF || d !== me) && !byDev[d].paused; }).map(function (d) { return byDev[d].t; });
}

function notifyComm(token, id) {
  if (!isRegistered(token)) return {ok: false};
  id = String(id || "");
  var c = CacheService.getScriptCache();
  if (!id || c.get("cmn_" + id)) return {ok: true, sent: 0};
  c.put("cmn_" + id, "1", 600);
  var kind = "", text = "", ticker = "", found = false, i;
  var ps = _postsSheet(), pl = ps.getLastRow();
  if (pl >= 2) {
    var from = Math.max(2, pl - 79), pr = ps.getRange(from, 1, pl - from + 1, 5).getValues();
    for (i = pr.length - 1; i >= 0; i--) if (pr[i][0] === id) {
      if (_dev(pr[i][2]) !== _dev(token)) return {ok: false};
      kind = "post"; ticker = String(pr[i][3] || ""); text = String(pr[i][4] || ""); found = true; break;
    }
  }
  if (!found) {
    var cs = _commentsSheet(), cl = cs.getLastRow();
    if (cl >= 2) {
      var cf = Math.max(2, cl - 79), cr = cs.getRange(cf, 1, cl - cf + 1, 5).getValues();
      for (i = cr.length - 1; i >= 0; i--) if (cr[i][0] === id) {
        if (_dev(cr[i][3]) !== _dev(token)) return {ok: false};
        kind = "comment"; text = String(cr[i][4] || ""); found = true; break;
      }
    }
  }
  if (!found) return {ok: false};
  var name = _nameMap()[_dev(token)] || "익명";
  var title = kind === "post" ? "💬 새 글 · " + name : "💬 새 댓글 · " + name;
  var body = (ticker ? "$" + ticker + " " : "") + (text ? text.replace(/\s+/g, " ").slice(0, 60) : "사진을 올렸어요");
  var tokens = _commTargets(token);
  if (!tokens.length) return {ok: true, sent: 0};
  var url = "https://fcm.googleapis.com/v1/projects/" + PropertiesService.getScriptProperties().getProperty("PROJECT_ID") + "/messages:send";
  var auth = "Bearer " + getAccessToken();
  var res = UrlFetchApp.fetchAll(tokens.map(function (t) {
    return {url: url, method: "post", contentType: "application/json", headers: {Authorization: auth}, muteHttpExceptions: true,
            payload: JSON.stringify({message: {token: t, notification: {title: title, body: body}, data: {url: COMM_LINK},
                                              webpush: {fcm_options: {link: COMM_LINK}}}})};
  }));
  var sent = 0;
  res.forEach(function (r, k) {
    var code = r.getResponseCode();
    if (code === 200) sent++;
    
  });
  return {ok: true, sent: sent};
}