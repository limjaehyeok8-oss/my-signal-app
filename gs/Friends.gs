// ==========================================================
// Friends.gs — 친구와 종목·평단 보기
//  - profiles 시트: token | code(친구 코드) | nickname | showAvg(1=평단 공개)
//  - links 시트   : tokenA | tokenB   (서로 연결되면 두 줄: A→B, B→A)
//  - holdings 시트 F열 "hidden" : 1이면 그 종목은 친구에게 숨김
// 이 앱에 등록한 사람들끼리 자동으로 서로의 종목이 보여요 (코드 입력 없음).
// 선택: Apps Script 프로젝트 설정 → 스크립트 속성에 FRIEND_ROOM_KEY (방 비밀번호)를 넣으면,
//       그 비밀번호를 한 번 입력한 사람들끼리만 보여요. (주소를 아는 낯선 사람 차단용)
// 등록한 사람의 종목·평단·수익률은 전부 공유돼요 (숨기기 없음).
// ==========================================================
var PROFILES_SHEET = "profiles";
var LINKS_SHEET = "links";

var _ssMemo = null;
function _ss() { return _ssMemo || (_ssMemo = getSheet().getParent()); }
function _sheet(name, header) {
  var ss = _ss(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); }
  return sh;
}
function getProfilesSheet() { return _sheet(PROFILES_SHEET, ["token", "code", "nickname", "showAvg", "joined"]); }
function getLinksSheet() { return _sheet(LINKS_SHEET, ["tokenA", "tokenB"]); }

function _newCode(existing) {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 헷갈리는 글자(0,O,1,I) 제외
  for (var tries = 0; tries < 50; tries++) {
    var c = "";
    for (var i = 0; i < 6; i++) c += chars.charAt(Math.floor(Math.random() * chars.length));
    if (!existing[c]) return c;
  }
  return null;
}

// 내 프로필 (없으면 만들기). 반환: {row, token, code, nickname, showAvg}
function _myProfile(token) {
  var sh = getProfilesSheet();
  var last = sh.getLastRow();
  var rows = last >= 2 ? sh.getRange(2, 1, last - 1, 5).getValues() : [];
  var codes = {};
  for (var i = 0; i < rows.length; i++) {
    codes[rows[i][1]] = true;
    if (rows[i][0] === token) {
      return {row: i + 2, token: token, code: rows[i][1], nickname: String(rows[i][2] || ""), showAvg: rows[i][3] !== 0 && rows[i][3] !== "0"};
    }
  }
  var code = _newCode(codes);
  if (!code) return null;
  sh.appendRow([token, code, "", 1]);
  return {row: sh.getLastRow(), token: token, code: code, nickname: "", showAvg: true};
}

function _profileByCode(code) {
  var sh = getProfilesSheet();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var rows = sh.getRange(2, 1, last - 1, 5).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][1] === code) return {token: rows[i][0], code: code, nickname: String(rows[i][2] || ""), showAvg: rows[i][3] !== 0 && rows[i][3] !== "0"};
  }
  return null;
}

function _profileByToken(token) {
  var sh = getProfilesSheet();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var rows = sh.getRange(2, 1, last - 1, 5).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === token) return {token: token, code: rows[i][1], nickname: String(rows[i][2] || ""), showAvg: rows[i][3] !== 0 && rows[i][3] !== "0"};
  }
  return null;
}

function _roomKey() { return PropertiesService.getScriptProperties().getProperty("FRIEND_ROOM_KEY") || ""; }

function _isJoined(token) {
  if (!_roomKey()) return true;                 // 비밀번호를 안 쓰면 모두 입장 상태
  var sh = getProfilesSheet(), last = sh.getLastRow();
  if (last < 2) return false;
  var rows = sh.getRange(2, 1, last - 1, 5).getValues();
  for (var i = 0; i < rows.length; i++) if (rows[i][0] === token) return String(rows[i][4]) === "1";
  return false;
}

// 나를 뺀 "알림 등록한 사람" 전부 (비밀번호를 쓰면 입장한 사람만)
// 같은 폰(앱 설치)은 알림 토큰이 새로 발급돼도 ':' 앞부분이 같아요 → 그걸로 "한 사람"을 판단
function _dev(token) { return String(token || "").split(":")[0]; }

// 나를 뺀 다른 사람들의 "기기 ID" 목록 (한 사람 = 한 번만)
function _friendDevs(token) {
  var me = _dev(token);
  var sh = getSheet(), last = sh.getLastRow();
  if (last < 2) return [];
  var seen = {}, out = [];
  sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
    var t = String(r[0] || "").trim();
    if (!t) return;
    var d = _dev(t);
    if (d === me || seen[d]) return;
    seen[d] = true;
    if (_isJoined(t)) out.push(d);
  });
  return out;
}
function _friendTokens(token) {            // 예전 코드와의 호환용: 각 사람당 토큰 하나
  if (!_isJoined(token)) return [];
  var devs = _friendDevs(token), want = {}, out = [];
  devs.forEach(function (d) { want[d] = true; });
  var sh = getSheet(), last = sh.getLastRow();
  if (last < 2) return [];
  var seen = {};
  sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
    var t = String(r[0] || "").trim(), d = _dev(t);
    if (t && want[d] && !seen[d]) { seen[d] = true; out.push(t); }
  });
  return out;
}
// 한 사람의 표시 이름: 그 기기의 프로필들 중 닉네임이 있는 것
function _devNames() {
  var sh = getProfilesSheet(), last = sh.getLastRow(), m = {};
  if (last >= 2) sh.getRange(2, 1, last - 1, 6).getValues().forEach(function (r) {
    var d = _dev(r[0]);
    if (!m[d]) m[d] = {code: r[1], nick: "", photo: ""};
    if (r[2]) m[d].nick = String(r[2]);
    if (r[5]) m[d].photo = String(r[5]);
  });
  return m;
}
function _devLabel(m) { return m.nick ? m.nick : "익명 " + String(m.code).slice(0, 3); }

function joinRoom(token, key) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var real = _roomKey();
  if (!real) return {ok: true, msg: "비밀번호 없이 모두 보여요"};
  if (String(key || "").trim() !== real) return {ok: false, msg: "비밀번호가 달라요"};
  var me = _myProfile(token);
  if (!me) return {ok: false, msg: "저장하지 못했어요"};
  getProfilesSheet().getRange(me.row, 5).setValue(1);
  return {ok: true, msg: "입장했어요"};
}

function _displayName(p) { return p.nickname ? p.nickname : "익명 " + String(p.code).slice(0, 3); }

// 화면용: 내 코드/닉네임/공개설정/친구 목록/숨긴 종목
function getFriendInfo(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var me = _myProfile(token);
  if (!me) return {ok: false, msg: "친구 코드를 만들지 못했어요. 잠시 후 다시 시도하세요"};
  var friends = [];
  var dn = _devNames();
  _friendDevs(token).forEach(function (d) {
    if (dn[d]) friends.push({code: dn[d].code, name: _devLabel(dn[d])});
  });
  // 내가 친구에게 숨긴 종목
  var hidden = [];
  var hs = getHoldingsSheet(), last = hs.getLastRow();
  if (last >= 2) {
    hs.getRange(2, 1, last - 1, 6).getValues().forEach(function (r) { if (r[0] === token && r[1] && String(r[5]) === "1") hidden.push(r[1]); });
  }
  return {ok: true, code: me.code, nickname: me.nickname, showAvg: me.showAvg, friends: friends, hidden: hidden,
          roomRequired: !!_roomKey(), joined: _isJoined(token)};
}

function setNickname(token, name) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  name = String(name || "").replace(/[\r\n]/g, " ").trim().slice(0, 12);
  var me = _myProfile(token);
  if (!me) return {ok: false, msg: "저장하지 못했어요"};
  var psh = getProfilesSheet(), pl = psh.getLastRow(), mine = _dev(token);
  if (pl >= 2) psh.getRange(2, 1, pl - 1, 1).getValues().forEach(function (r, i) { if (_dev(r[0]) === mine) psh.getRange(i + 2, 3).setValue(name); });
  CacheService.getScriptCache().remove("photos_v1");
  return {ok: true, msg: name ? "닉네임을 '" + name + "'(으)로 저장했어요" : "닉네임을 지웠어요"};
}

// ===== 프로필 사진: 96x96 작은 JPEG 를 profiles 시트 6번째 칸에 저장 =====
function setPhoto(token, photo) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  photo = String(photo || "");
  if (photo && (photo.indexOf("data:image/jpeg;base64,") !== 0 || photo.length > 14000)) return {ok: false, msg: "사진이 너무 크거나 형식이 달라요"};
  var me = _myProfile(token);
  if (!me) return {ok: false, msg: "저장하지 못했어요"};
  var psh = getProfilesSheet(), pl = psh.getLastRow(), mine = _dev(token);
  if (!psh.getRange(1, 6).getValue()) psh.getRange(1, 6).setValue("photo");
  if (pl >= 2) psh.getRange(2, 1, pl - 1, 1).getValues().forEach(function (r, i) { if (_dev(r[0]) === mine) psh.getRange(i + 2, 6).setValue(photo); });
  CacheService.getScriptCache().remove("photos_v1");
  return {ok: true, msg: photo ? "프로필 사진을 저장했어요" : "프로필 사진을 지웠어요"};
}

// 이름(닉네임/익명코드) → 사진. 친구·커뮤 화면에서 같이 씀 (10분 캐시)
function getPhotos(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var c = CacheService.getScriptCache(), hit = c.get("photos_v1");
  if (hit) { try { return {ok: true, map: JSON.parse(hit)}; } catch (e) {} }
  var dn = _devNames(), map = {};
  Object.keys(dn).forEach(function (d) { if (dn[d].photo) map[_devLabel(dn[d])] = dn[d].photo; });
  try { c.put("photos_v1", JSON.stringify(map), 600); } catch (e) { /* 100KB 넘으면 캐시 생략 */ }
  return {ok: true, map: map};
}

function setShowAvg(token, show) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var me = _myProfile(token);
  if (!me) return {ok: false, msg: "저장하지 못했어요"};
  getProfilesSheet().getRange(me.row, 4).setValue(show ? 1 : 0);
  return {ok: true, msg: show ? "친구에게 평단가도 보여요" : "친구에게 평단가는 숨기고 수익률만 보여요"};
}

// 친구 코드 입력해서 서로 연결
function addFriend(token, code) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  code = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) return {ok: false, msg: "친구 코드는 6글자예요"};

  // 코드 무작위 대입 방지: 시간당 10번까지
  var cache = CacheService.getScriptCache();
  var key = "friendTry_" + String(token).slice(-24);
  var n = Number(cache.get(key) || 0);
  if (n >= 10) return {ok: false, msg: "시도가 너무 많아요. 한 시간 뒤에 다시 해 보세요"};
  cache.put(key, String(n + 1), 3600);

  var me = _myProfile(token);
  var other = _profileByCode(code);
  if (!other) return {ok: false, msg: "그 코드를 가진 친구가 없어요"};
  if (other.token === token) return {ok: false, msg: "내 코드예요. 친구의 코드를 입력하세요"};
  if (_friendTokens(token).indexOf(other.token) !== -1) return {ok: false, msg: "이미 연결된 친구예요"};

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getLinksSheet();
    sh.appendRow([token, other.token]);
    sh.appendRow([other.token, token]);
  } finally { lock.releaseLock(); }
  return {ok: true, msg: _displayName(other) + " 님과 연결됐어요. 서로의 종목이 보여요", name: _displayName(other)};
}

function removeFriend(token, code) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var other = _profileByCode(String(code || "").trim().toUpperCase());
  if (!other) return {ok: false, msg: "친구를 찾지 못했어요"};
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getLinksSheet();
    for (var r = sh.getLastRow(); r >= 2; r--) {
      var v = sh.getRange(r, 1, 1, 2).getValues()[0];
      if ((v[0] === token && v[1] === other.token) || (v[0] === other.token && v[1] === token)) sh.deleteRow(r);
    }
  } finally { lock.releaseLock(); }
  return {ok: true, msg: "연결을 끊었어요 (서로 안 보여요)"};
}

// 이 종목을 친구에게 숨길지
function setHidden(token, symbol, hidden) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  symbol = String(symbol || "").trim().toUpperCase();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var hs = getHoldingsSheet(), last = hs.getLastRow();
    if (last < 2) return {ok: false, msg: "종목을 찾지 못했어요"};
    var rows = hs.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] === token && rows[i][1] === symbol) {
        if (!hs.getRange(1, 6).getValue()) hs.getRange(1, 6).setValue("hidden");
        hs.getRange(i + 2, 6).setValue(hidden ? 1 : "");
        return {ok: true, msg: hidden ? symbol + " 은(는) 친구에게 안 보여요" : symbol + " 을(를) 친구에게 보여줘요"};
      }
    }
    return {ok: false, msg: symbol + " 은(는) 내 보유 종목에 없어요"};
  } finally { lock.releaseLock(); }
}

// 친구들의 종목 (숨긴 종목 제외, 평단 비공개면 평단 숨김)
// 기기별 알림 꺼짐 여부 (같은 기기는 가장 최근 줄 기준)
function _devPausedMap() {
  var sh = getSheet(), last = sh.getLastRow(), m = {};
  if (last < 2) return m;
  sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) {
    var t = String(r[0]).trim(); if (t) m[_dev(t)] = (r[2] === true);
  });
  return m;
}

function friendHoldings(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var devs = _friendDevs(token), meDev = _dev(token);
  var isF = {}; devs.forEach(function (d) { isF[d] = true; });
  var hs = getHoldingsSheet(), last = hs.getLastRow();
  var rows = last >= 2 ? hs.getRange(2, 1, last - 1, 6).getValues() : [];
  var byDev = {}, symSet = {};
  rows.forEach(function (r) {
    var d = _dev(r[0]);
    if ((!isF[d] && d !== meDev) || !r[1]) return;
    var sym = String(r[1]);
    (byDev[d] = byDev[d] || {})[sym] = Number(r[2]) || null;     // 같은 종목이면 나중 값이 이김
    symSet[sym] = true;
  });
  var prices = Object.keys(symSet).length ? _cachedPrices(Object.keys(symSet)) : {};
  var dn = _devNames(), pm = _devPausedMap(), out = [], me = [];
  if (byDev[meDev]) me = Object.keys(byDev[meDev]).map(function (sym) {
    var avg = byDev[meDev][sym], price = prices[sym];
    return {symbol: sym, price: price == null ? null : price, avgPrice: avg, pnl: (avg && price) ? (price / avg - 1) * 100 : null};
  });
  devs.forEach(function (d) {
    if (!byDev[d] || !dn[d]) return;                              // 보여줄 종목이 없는 사람은 뺌
    var list = Object.keys(byDev[d]).map(function (sym) {
      var avg = byDev[d][sym], price = prices[sym];
      var pnl = (avg && price) ? (price / avg - 1) * 100 : null;
      return {symbol: sym, price: price == null ? null : price, avgPrice: avg, pnl: pnl};
    });
    out.push({code: dn[d].code, name: _devLabel(dn[d]), showAvg: true, on: pm[d] !== true, holdings: list});
  });
  return {ok: true, friends: out, me: me};
}