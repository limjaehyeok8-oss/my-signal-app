// ===== BtcBottom.gs : ₿ 비트코인 "바닥 구간 접근" 지표 + 자동 알림 =====
// 200주선(=일봉 1400일 단순평균), Pi Cycle Bottom(150일 EMA < 0.745×471일 SMA), 마이어 배수.
// 매수 신호가 아니라 '역사적으로 바닥이 형성된 구간에 가까워졌다'는 참고 알림이에요. (표본 3~4번 사이클)
var BTCB_KEY = "BTCB_STATE";

function _btcbCloses() {
  var url = "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?range=6y&interval=1d";
  var j = JSON.parse(UrlFetchApp.fetch(url, {muteHttpExceptions: true}).getContentText()).chart.result[0];
  var c = j.indicators.quote[0].close, out = [];
  for (var i = 0; i < c.length; i++) if (c[i] != null && c[i] > 0) out.push(Number(c[i]));
  return out;
}
function _btcbSma(a, n) { if (a.length < n) return null; var s = 0; for (var i = a.length - n; i < a.length; i++) s += a[i]; return s / n; }
function _btcbEma(a, n) { var k = 2 / (n + 1), e = a[0]; for (var i = 1; i < a.length; i++) e = a[i] * k + e * (1 - k); return e; }

// 순수 계산 (테스트 가능)
function btcbCompute(closes) {
  var p = closes[closes.length - 1];
  var w200 = _btcbSma(closes, 1400), s471 = _btcbSma(closes, 471), s200 = _btcbSma(closes, 200);
  var e150 = _btcbEma(closes, 150);
  var peak = Math.max.apply(null, closes);
  var pi = s471 != null ? e150 < 0.745 * s471 : false;
  var ratio = w200 ? p / w200 : null;
  // 0=멀다, 1=200주선 위 10% 이내, 2=200주선 이하
  var level = ratio == null ? 0 : ratio <= 1 ? 2 : ratio <= 1.10 ? 1 : 0;
  return {price: p, w200: w200, ratio: ratio, level: level, pi: pi, e150: e150, piLine: s471 != null ? 0.745 * s471 : null,
          mayer: s200 ? p / s200 : null, dd: p / peak - 1, at: new Date().toISOString()};
}

function getBtcBottom(token) {
  var c = CacheService.getScriptCache(), hit = c.get("btcb_json");
  if (hit) return JSON.parse(hit);
  try {
    var r = btcbCompute(_btcbCloses()); r.ok = true;
    c.put("btcb_json", JSON.stringify(r), 1800);
    return r;
  } catch (e) { return {ok: false, msg: "계산 실패"}; }
}

// 10분 트리거(checkWatchTargets)에 얹혀 돌지만 3시간에 한 번만 실제 계산
function checkBtcBottom(force) {
  var P = PropertiesService.getScriptProperties();
  var last = Number(P.getProperty("BTCB_LAST") || 0);
  if (force !== true && Date.now() - last < 3 * 3600 * 1000) return "대기";
  var r;
  try { r = btcbCompute(_btcbCloses()); } catch (e) { return "시세 실패"; }
  P.setProperty("BTCB_LAST", String(Date.now()));
  var st = {level: 0, pi: false};
  try { st = JSON.parse(P.getProperty(BTCB_KEY) || "") || st; } catch (e) {}
  var usd = function (v) { return "$" + Math.round(v).toLocaleString("en-US"); };
  var gap = r.ratio != null ? ((r.ratio - 1) * 100) : 0;
  var tail = "\n(참고용 지표예요. 매수 신호가 아니며, 2022년엔 200주선 첫 도달 후 29% 더 내렸어요)";
  var msgs = [];
  if (r.level > st.level) {
    if (r.level === 2) msgs.push(["₿ 비트코인 200주선 도달", "현재 " + usd(r.price) + " · 200주선 " + usd(r.w200) + " (" + gap.toFixed(1) + "%)\n역사적으로 바닥이 형성된 구간이에요." + tail]);
    else msgs.push(["₿ 바닥 구간 접근", "현재 " + usd(r.price) + " · 200주선 " + usd(r.w200) + "까지 " + gap.toFixed(1) + "% 남음" + tail]);
  }
  if (r.pi && !st.pi) msgs.push(["₿ Pi Cycle 바닥 신호 켜짐", "150일 EMA " + usd(r.e150) + " < 기준선 " + usd(r.piLine) + "\n과거 사이클 저점 부근에서 켜진 지표예요." + tail]);
  // 재무장: 200주선에서 15% 넘게 멀어지면 레벨 리셋, Pi는 꺼지면 리셋
  var newLevel = r.level;
  if (r.level < st.level && r.ratio != null && r.ratio <= 1.15) newLevel = st.level;
  P.setProperty(BTCB_KEY, JSON.stringify({level: newLevel, pi: r.pi, at: r.at}));
  msgs.forEach(function (m) { try { sendPush(m[0], m[1]); } catch (e) { try { runLog("err", "btcb push 실패: " + e.message); } catch (e2) {} } });
  return "BTC 바닥지표 알림 " + msgs.length + "건";
}

function testBtcBottom() { Logger.log(JSON.stringify(btcbCompute(_btcbCloses()))); }
