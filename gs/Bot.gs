// ===== Bot.gs : 🤖 시뮬봇 2개 (가상 1,000만원씩, 신호를 실제처럼 따라가 보는 봇) =====
//  · 주봉봇 : 주봉 하이킨아시가 양봉이면 들고, 음봉이 되면 팝니다.
//  · 일봉봇 : 1234(W자) 매매. 두 번째 바닥이 첫 바닥보다 높게 끝나고 다시 양봉이 되면 사고,
//             첫 바닥을 종가로 깨면 손절, 하이킨아시 음봉 2연속이면 팝니다.
// 처음 한 번: setupBotTrigger 실행 (매일 아침 8시쯤 자동 기록). 규칙을 바꾸면 resetBot 으로 새로 시작하세요.
var BOT_START_KRW = 30000000;  // 봇마다 시작 가상 자금 (원) · 5종목 × 600만원
var BOT_VER = "v4-3bots-60";    // 규칙·자금을 바꾸면 값을 바꿔요 → 다음 실행 때 기록을 한 번 비우고 새로 시작
var BOT_FEE       = 0.0025;    // 수수료+환전+슬리피지 (살 때·팔 때 각각 0.25%)
var BOT_SHEET     = "bot";

// 주봉봇이 훑어보는 종목 (지수·섹터 ETF + 업종별 대형주, 60여 개). 동시에는 최대 5종목 × 600만원만 보유
var BOT_W_MAX = 5, BOT_M_MAX = 5, BOT_V_MAX = 2;
// 레버리지봇이 훑는 레버리지 ETF (변동성이 매우 큼 · 장기 보유하면 가치가 깎임)
var BOT_V_LIST = ["TQQQ","SOXL"];
var BOT_W_LIST = ["QQQ","SMH","IWM","XLF","XLE","XLV","XLK","GLD",
  "NVDA","MSFT","GOOGL","AMZN","META","AVGO","LLY","JPM","AAPL","TSLA","TSM","AMD","NFLX","COST","V","UNH","XOM","BRK-B",
  "ORCL","CRM","ADBE","NOW","UBER","PLTR","MU","QCOM","ASML","AMAT","ANET","PANW","CRWD","COIN",
  "HD","WMT","KO","PG","MCD","MA","BAC","GS","ABBV","JNJ","MRK","ISRG","CAT","GE","LMT","DIS","CVX","NKE","BA","IBM","CSCO"];
// 일봉봇이 매일 훑는 종목 (거래 많은 대형주·ETF, 레버리지 제외). 최대 5종목 × 200만원
var BOT_D_MAX  = 5;
var BOT_D_LIST = ["SPY","QQQ","IWM","DIA","SMH","XLF","XLE","XLV","XLK","XLI","GLD","TLT",
  "AAPL","MSFT","GOOGL","AMZN","META","TSLA","NFLX","ORCL","CRM","ADBE","NOW","UBER","SHOP","PLTR","APP",
  "NVDA","AVGO","AMD","INTC","QCOM","MU","TSM","ASML","ARM","AMAT","LRCX","MRVL","ANET",
  "PANW","CRWD","NET","DDOG","SNOW","IBM","CSCO","DELL","COIN","MSTR","HOOD",
  "JPM","BAC","GS","MS","V","MA","AXP","BRK-B","SOFI",
  "LLY","UNH","JNJ","ABBV","MRK","ISRG","COST","WMT","KO","PG","MCD",
  "HD","NKE","SBUX","BA","CAT","GE","LMT","DIS","BABA",
  "XOM","CVX","FCX","VST","CEG","NEE"];

var BOT_DEFS = {
  w: {name: "주봉봇", desc: "주봉 하이킨아시 양봉이면 보유, 음봉이 되면 매도", max: BOT_W_MAX},
  d: {name: "일봉봇 (1234·W자)", desc: "W자 두 번째 바닥이 첫 바닥보다 높고 다시 양봉이 되면 매수", max: BOT_D_MAX},
  m: {name: "모멘텀봇", desc: "200일·50일선 위에서 최근 6개월 상승률이 가장 강한 종목 5개를 들고, 50일선을 깨거나 순위가 15위 밖으로 밀리면 매도", max: BOT_M_MAX},
  v: {name: "레버리지봇 (200일선)", desc: "TQQQ·SOXL 중 종가가 200일선 위인 종목을 3개월 상승률 순으로 최대 2개 보유, 200일선 아래로 내려가면 매도. 신호가 뜰 때마다 알림 (2010~2026 백테스트에서 VIDYA보다 성과가 좋았던 규칙)", max: BOT_V_MAX}
};

// ---------- 공통 계산 (백테스트·전략에서도 같이 씀) ----------
// 하이킨아시 양봉 여부 배열
function botHaGreen(o, h, l, c) {
  var g = [], ho = 0, hc = 0;
  for (var i = 0; i < c.length; i++) {
    var nc = (o[i] + h[i] + l[i] + c[i]) / 4;
    ho = i === 0 ? (o[i] + c[i]) / 2 : (ho + hc) / 2;
    hc = nc;
    g.push(hc > ho);
  }
  return g;
}
// 날짜(yyyy-MM-dd) → 주 번호 (월요일 시작)
function botWeekKey(ds) {
  var p = String(ds).split("-");
  return Math.floor((Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / 86400000 + 3) / 7);
}
// 일봉 → 주봉 하이킨아시. 반환: {end: [그 주의 마지막 봉 인덱스], green: [그 주 양봉 여부]}
// lastDone=false 이면 마지막(진행 중인) 주는 뺌
function botWeeklyHa(dates, o, h, l, c, lastDone) {
  var wo = [], wh = [], wl = [], wc = [], end = [], cur = null;
  for (var i = 0; i < c.length; i++) {
    var k = botWeekKey(dates[i]);
    if (k !== cur) { cur = k; wo.push(o[i]); wh.push(h[i]); wl.push(l[i]); wc.push(c[i]); end.push(i); }
    else { var j = wc.length - 1; wh[j] = Math.max(wh[j], h[i]); wl[j] = Math.min(wl[j], l[i]); wc[j] = c[i]; end[j] = i; }
  }
  var g = botHaGreen(wo, wh, wl, wc);
  if (!lastDone) { end.pop(); g.pop(); }
  return {end: end, green: g};
}
// 1234(W자): i번째 봉이 "4번(두 번째 바닥 뒤 첫 양봉)"이면 {l1: 첫 바닥, l2: 두 번째 바닥}, 아니면 null
//   1번 = 하락(음봉 3개 이상) 끝의 첫 바닥,  2번 = 반등(양봉 2개 이상),  3번 = 다시 눌림(음봉),  4번 = 다시 양봉
function botW1234(g, lows, i) {
  if (i < 12 || !g[i] || g[i - 1]) return null;
  var a2 = i - 1; while (a2 > 0 && !g[a2 - 1]) a2--;                 // 두 번째 음봉 구간 [a2 .. i-1]
  var a1 = a2 - 1; if (a1 < 0 || !g[a1]) return null;
  while (a1 > 0 && g[a1 - 1]) a1--;                                   // 반등(양봉) 구간 [a1 .. a2-1]
  if (a2 - a1 < 2) return null;
  var a0 = a1 - 1; if (a0 < 0 || g[a0]) return null;
  while (a0 > 0 && !g[a0 - 1]) a0--;                                  // 첫 음봉 구간 [a0 .. a1-1]
  if (a1 - a0 < 3 || i - a0 > 45) return null;
  var l1 = Infinity, l2 = Infinity, k;
  for (k = a0; k <= a1; k++) l1 = Math.min(l1, lows[k]);
  for (k = a2; k <= i; k++) l2 = Math.min(l2, lows[k]);
  if (!(l2 > l1)) return null;                                        // 두 번째 바닥이 더 낮으면 W자가 아님
  for (k = Math.max(0, i - 30); k < a0; k++) if (lows[k] < l1) return null;   // 첫 바닥이 최근 30봉의 진짜 바닥이어야 함
  return {l1: l1, l2: l2};
}

// ---------- 저장 ----------
function _botSheet() {
  var ss = getSheet().getParent(), sh = ss.getSheetByName(BOT_SHEET);
  if (!sh) { sh = ss.insertSheet(BOT_SHEET); sh.getRange(1, 1, 1, 2).setValues([["key", "json"]]); }
  return sh;
}
function _botLoadAll() {
  var sh = _botSheet(), last = sh.getLastRow(), m = {};
  if (last >= 2) sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    try { if (r[0]) m[r[0]] = JSON.parse(String(r[1])); } catch (e) {}
  });
  return m;
}
function _botSaveAll(m) {
  var sh = _botSheet(), keys = Object.keys(m).filter(function (k) { return /^(w|d|m|v)_(state|eq|log|closed)$/.test(k); }).sort();
  if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  if (keys.length) sh.getRange(2, 1, keys.length, 2).setValues(keys.map(function (k) { return [k, JSON.stringify(m[k])]; }));
}

// ---------- 시세 ----------
// 마감된 일봉만: {sym: {dates, o, h, l, c}}
function _botFetch(syms, range) {
  var out = {}, now = new Date();
  var etToday = Utilities.formatDate(now, "America/New_York", "yyyy-MM-dd");
  var etHM = Number(Utilities.formatDate(now, "America/New_York", "HHmm"));
  for (var s0 = 0; s0 < syms.length; s0 += 30) {
    var chunk = syms.slice(s0, s0 + 30), resps;
    try {
      resps = UrlFetchApp.fetchAll(chunk.map(function (s) {
        return {url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=" + range + "&interval=1d", muteHttpExceptions: true};
      }));
    } catch (e) { continue; }
    chunk.forEach(function (s, k) {
      try {
        if (resps[k].getResponseCode() !== 200) return;
        var r = JSON.parse(resps[k].getContentText()).chart.result[0], q = r.indicators.quote[0], ts = r.timestamp;
        var d = {dates: [], o: [], h: [], l: [], c: []}, off = (r.meta && r.meta.gmtoffset) || -18000;
        for (var i = 0; i < ts.length; i++) {
          if (q.close[i] == null || q.open[i] == null || q.high[i] == null || q.low[i] == null) continue;
          var ds = new Date((ts[i] + off) * 1000).toISOString().slice(0, 10);   // 거래소 현지 날짜
          if (s !== "KRW=X" && ds === etToday && etHM < 1610) continue;      // 아직 안 끝난 날은 뺌
          if (d.dates.length && d.dates[d.dates.length - 1] === ds) { d.dates.pop(); d.o.pop(); d.h.pop(); d.l.pop(); d.c.pop(); }
          d.dates.push(ds); d.o.push(q.open[i]); d.h.push(q.high[i]); d.l.push(q.low[i]); d.c.push(q.close[i]);
        }
        if (d.c.length) out[s] = d;
      } catch (e) {}
    });
  }
  return out;
}

// ---------- 봇별 "내일 주문" 정하기 ----------
function _botDecideWeekly(st, data, day, weekDone) {
  var orders = [], selling = 0, cands = [];
  BOT_W_LIST.forEach(function (s) {
    var d = data[s];
    if (!d || d.c.length < 60 || d.dates[d.dates.length - 1] !== day) return;
    var w = botWeeklyHa(d.dates, d.o, d.h, d.l, d.c, weekDone);
    if (w.green.length < 20) return;
    var green = w.green[w.green.length - 1];
    var held = st.pos.some(function (p) { return p.s === s; });
    if (held && !green) { orders.push({act: "sell", s: s, why: "주봉 하이킨아시 음봉 전환"}); selling++; }
    if (!held && green) { var n = d.c.length; cands.push({s: s, mom: n > 65 ? d.c[n - 1] / d.c[n - 66] - 1 : 0}); }
  });
  var slots = BOT_W_MAX - st.pos.length + selling;                  // 동시에 최대 BOT_W_MAX종목만 보유 → 양봉 종목이 많으면 최근 3개월 상승이 큰 순서로
  cands.sort(function (a, b) { return b.mom - a.mom; });
  cands.slice(0, Math.max(0, slots)).forEach(function (c) { orders.push({act: "buy", s: c.s, why: "주봉 하이킨아시 양봉 (최근 3개월 강한 순)"}); });
  return orders;
}
function _botDecideDaily(st, data, day) {
  var orders = [], selling = 0;
  st.pos.forEach(function (p) {
    var d = data[p.s];
    if (!d || d.dates[d.dates.length - 1] !== day) return;
    var n = d.c.length, g = botHaGreen(d.o, d.h, d.l, d.c), why = "";
    if (p.l1 && d.c[n - 1] < p.l1) why = "손절 (첫 바닥 " + p.l1.toFixed(2) + " 이탈)";
    else if (p.d !== day && !g[n - 1] && !g[n - 2]) why = "하이킨아시 음봉 2연속";
    if (why) { orders.push({act: "sell", s: p.s, why: why}); selling++; }
  });
  var slots = BOT_D_MAX - st.pos.length + selling, cands = [];
  if (slots > 0) BOT_D_LIST.forEach(function (s) {
    if (st.pos.some(function (p) { return p.s === s; })) return;
    var d = data[s];
    if (!d || d.c.length < 60 || d.dates[d.dates.length - 1] !== day) return;
    var n = d.c.length, w = botW1234(botHaGreen(d.o, d.h, d.l, d.c), d.l, n - 1);
    if (!w) return;
    cands.push({s: s, l1: w.l1, risk: (d.c[n - 1] / w.l1 - 1) * 100});
  });
  cands.sort(function (a, b) { return a.risk - b.risk; });          // 손절선이 가까운(잃을 폭이 작은) 순
  cands.slice(0, Math.max(0, slots)).forEach(function (c) {
    orders.push({act: "buy", s: c.s, l1: c.l1, why: "1234(W자) 4번 양봉 · 손절선 " + c.l1.toFixed(2) + " (-" + c.risk.toFixed(1) + "%)"});
  });
  return orders;
}

// VIDYA(60): 변동성(CMO)에 따라 반응 속도가 달라지는 60일 이동평균 (60선). 종가가 VIDYA 위면 상승 추세, 아래면 하락 추세.
var BOT_VIDYA_LEN = 60, BOT_VIDYA_CMO = 20;          // 길이는 백테스트(2010~2026, 레버리지 ETF 12종)에서 30·60·120·200 중 수익률이 가장 좋았던 60으로
// 백테스트 요약 (tools/vidya_bt.py 결과: [전략, 연수익%, 최대낙폭%, 누적%, 전반 연%, 후반 연%, 거래수, 승률%])
var BOT_V_BT = {"period":"2010-06 ~ 2026-11","ds":["2010-06","2010-07","2010-08","2010-09","2010-10","2010-11","2010-12","2011-01","2011-02","2011-03","2011-04","2011-05","2011-06","2011-07","2011-08","2011-09","2011-10","2011-11","2011-12","2012-01","2012-02","2012-03","2012-04","2012-05","2012-06","2012-07","2012-08","2012-09","2012-10","2012-11","2012-12","2013-01","2013-02","2013-03","2013-04","2013-05","2013-06","2013-07","2013-08","2013-09","2013-10","2013-11","2013-12","2014-01","2014-02","2014-03","2014-04","2014-05","2014-06","2014-07","2014-08","2014-09","2014-10","2014-11","2014-12","2015-01","2015-02","2015-03","2015-04","2015-05","2015-06","2015-07","2015-08","2015-09","2015-10","2015-11","2015-12","2016-01","2016-02","2016-03","2016-04","2016-05","2016-06","2016-07","2016-08","2016-09","2016-10","2016-11","2016-12","2017-01","2017-02","2017-03","2017-04","2017-05","2017-06","2017-07","2017-08","2017-09","2017-10","2017-11","2017-12","2018-01","2018-02","2018-03","2018-04","2018-05","2018-06","2018-07","2018-08","2018-09","2018-10","2018-11","2018-12","2019-01","2019-02","2019-03","2019-04","2019-05","2019-06","2019-07","2019-08","2019-09","2019-10","2019-11","2019-12","2020-01","2020-02","2020-03","2020-04","2020-05","2020-06","2020-07","2020-08","2020-09","2020-10","2020-11","2020-12","2021-01","2021-02","2021-03","2021-04","2021-05","2021-06","2021-07","2021-08","2021-09","2021-10","2021-11","2021-12","2022-01","2022-02","2022-03","2022-04","2022-05","2022-06","2022-07","2022-08","2022-09","2022-10","2022-11","2022-12","2023-01","2023-02","2023-03","2023-04","2023-05","2023-06","2023-07","2023-08","2023-09","2023-10","2023-11","2023-12","2024-01","2024-02","2024-03","2024-04","2024-05","2024-06","2024-07","2024-08","2024-09","2024-10","2024-11","2024-12","2025-01","2025-02","2025-03","2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08","2026-09","2026-10","2026-11"],"best":[1.0,1.0,1.0,1.0,1.0,0.98,1.05,1.2,1.32,1.21,1.31,1.23,1.01,1.04,0.95,0.95,0.9,0.84,0.84,0.89,1.02,1.15,1.02,0.84,0.88,0.89,0.93,0.91,0.84,0.82,0.8,0.8,0.85,0.91,0.96,1.1,1.04,1.17,1.09,1.29,1.45,1.54,1.72,1.63,1.93,1.97,1.88,2.13,2.45,2.29,2.7,2.62,2.27,2.67,2.57,2.29,2.9,2.65,2.67,3.1,2.61,2.8,2.53,2.53,2.55,2.57,2.38,2.31,2.31,2.36,2.06,2.21,1.96,2.42,2.65,2.9,2.76,3.14,3.31,3.76,4.13,4.56,4.62,5.59,4.85,5.52,5.88,6.44,7.96,8.01,7.74,9.8,9.42,8.4,7.6,8.76,8.37,7.97,8.58,7.7,6.55,6.55,6.55,6.55,6.35,6.24,7.91,5.89,6.08,6.75,6.14,6.51,7.45,8.34,9.85,9.6,7.33,5.83,5.83,6.03,6.04,7.17,9.24,7.92,7.36,10.74,12.35,12.72,13.56,13.63,14.64,14.34,16.82,17.57,19.21,16.22,18.53,21.58,22.27,16.59,15.71,15.71,15.71,15.71,15.71,15.71,15.71,15.71,15.71,15.71,15.71,15.71,14.08,16.2,14.01,18.1,21.35,23.99,21.35,16.78,15.4,18.93,23.88,24.6,30.52,32.28,27.01,33.3,38.67,32.3,25.8,25.84,25.25,27.27,27.17,27.87,25.65,24.31,24.31,24.2,26.02,25.92,26.59,32.87,40.84,36.66,36.42,45.59,44.51,33.48,63.02,102.33,115.38,51.75,54.41,56.31,41.69,42.15],"spy":[0.96,1.03,0.98,1.07,1.11,1.11,1.19,1.22,1.26,1.26,1.29,1.28,1.26,1.23,1.17,1.08,1.2,1.2,1.21,1.27,1.32,1.36,1.35,1.27,1.32,1.34,1.37,1.41,1.38,1.39,1.4,1.48,1.49,1.55,1.58,1.62,1.6,1.68,1.63,1.68,1.76,1.81,1.86,1.79,1.87,1.89,1.9,1.95,1.99,1.96,2.04,2.01,2.06,2.11,2.11,2.04,2.16,2.13,2.15,2.17,2.13,2.18,2.04,1.99,2.16,2.17,2.13,2.03,2.02,2.16,2.17,2.21,2.21,2.29,2.3,2.3,2.26,2.34,2.39,2.43,2.53,2.53,2.56,2.59,2.61,2.66,2.67,2.72,2.79,2.87,2.91,3.07,2.96,2.88,2.89,2.96,2.98,3.09,3.19,3.21,2.99,3.04,2.77,3.0,3.09,3.15,3.28,3.07,3.28,3.33,3.28,3.34,3.41,3.54,3.64,3.64,3.35,2.93,3.31,3.46,3.52,3.73,3.99,3.84,3.75,4.15,4.31,4.26,4.38,4.58,4.82,4.86,4.96,5.09,5.24,4.99,5.34,5.3,5.55,5.25,5.1,5.29,4.83,4.84,4.44,4.85,4.65,4.22,4.56,4.82,4.54,4.82,4.7,4.88,4.95,4.98,5.3,5.47,5.38,5.13,5.02,5.48,5.73,5.82,6.12,6.32,6.07,6.37,6.6,6.68,6.83,6.98,6.92,7.33,7.15,7.34,7.25,6.85,6.79,7.21,7.58,7.76,7.92,8.2,8.39,8.41,8.42,8.54,8.47,8.05,8.9,9.36,9.27,9.27,9.52,9.49,9.4,8.92],"ew":[0.85,1.02,0.81,1.1,1.25,1.28,1.55,1.68,1.85,1.78,1.91,1.81,1.64,1.53,1.14,0.9,1.24,1.13,1.12,1.39,1.59,1.79,1.67,1.31,1.45,1.46,1.61,1.67,1.52,1.55,1.62,1.86,1.94,2.13,2.23,2.47,2.34,2.7,2.47,2.8,3.14,3.42,3.73,3.41,3.9,3.97,3.84,4.16,4.57,4.32,4.91,4.64,4.98,5.52,5.46,4.86,5.89,5.6,5.65,6.15,5.81,6.0,4.73,4.08,5.19,5.51,5.07,3.69,3.53,4.37,4.29,4.83,4.51,5.51,5.68,6.02,5.4,6.36,6.61,7.28,8.24,8.36,8.65,8.97,9.34,10.09,10.51,11.39,12.42,13.07,13.27,16.02,14.53,13.28,12.84,15.0,14.74,15.86,17.81,17.07,12.29,12.62,9.1,11.84,13.51,14.13,15.95,12.14,15.29,16.05,14.4,14.81,16.36,19.06,20.87,20.53,16.57,8.23,11.85,14.24,15.92,18.24,22.24,19.55,18.64,27.43,31.78,33.05,36.17,36.77,41.01,40.41,45.25,44.68,49.82,42.94,50.76,49.62,50.83,37.65,33.46,34.44,21.81,20.18,14.76,20.02,17.32,12.32,14.25,16.43,12.77,17.07,16.39,17.97,17.56,20.97,24.42,27.44,25.11,20.82,18.29,24.96,30.76,32.36,39.78,42.4,35.29,41.62,47.25,47.18,47.41,48.81,47.8,55.89,50.71,53.02,48.07,36.65,34.65,42.67,52.7,56.18,58.73,68.49,77.94,73.21,72.74,75.44,68.84,59.67,88.88,115.02,113.9,100.37,114.81,116.66,96.92,70.67],"bars":[["200일선 · TQQQ+SOXL",25.5,-67.2],["200일선 · TQQQ만",29.4,-48.3],["VIDYA60 · TQQQ+SOXL",18.6,-65.6],["VIDYA120 · TQQQ+SOXL",16.5,-72.6],["S&P500(SPY)",14.2,-33.7],["12종 그냥 보유",29.5,-79.8]]};
function botVidya(c) {
  var n = c.length, alpha = 2 / (BOT_VIDYA_LEN + 1), vid = new Array(n), i, j, v = 0;
  if (n < BOT_VIDYA_LEN) return {vid: vid};
  for (i = 0; i < BOT_VIDYA_LEN; i++) v += c[i]; v /= BOT_VIDYA_LEN;                   // 처음 120일 평균으로 시작
  for (i = BOT_VIDYA_LEN - 1; i < n; i++) {
    var up = 0, dn = 0;
    for (j = Math.max(1, i - BOT_VIDYA_CMO + 1); j <= i; j++) { var df = c[j] - c[j - 1]; if (df > 0) up += df; else dn -= df; }
    var k = (up + dn) > 0 ? Math.abs(up - dn) / (up + dn) : 0;                          // |CMO| (0~1)
    if (i > BOT_VIDYA_LEN - 1) v = alpha * k * c[i] + (1 - alpha * k) * v;
    vid[i] = v;
  }
  return {vid: vid};
}
function _botDecideVidya(st, data, day) {            // 200일선 + 3개월 모멘텀 순위 (함수 이름은 예전 그대로)
  var info = {}, up = [], orders = [], selling = 0;
  BOT_V_LIST.forEach(function (s) {
    var d = data[s];
    if (!d || d.c.length < 205 || d.dates[d.dates.length - 1] !== day) return;
    var n = d.c.length - 1, sma = botSma(d.c, 200);
    info[s] = {up: d.c[n] > sma, gap: d.c[n] / sma - 1, mom: d.c[n] / d.c[n - 63] - 1};
    if (info[s].up) up.push(s);
  });
  st.pos.forEach(function (p) { var f = info[p.s]; if (f && !f.up) { orders.push({act: "sell", s: p.s, why: "종가가 200일선 아래로 (" + (f.gap * 100).toFixed(1) + "%)"}); selling++; } });
  up.sort(function (a, b) { return info[b].mom - info[a].mom; });
  var slots = BOT_V_MAX - st.pos.length + selling;
  up.filter(function (s) { return !st.pos.some(function (p) { return p.s === s; }); }).slice(0, Math.max(0, slots)).forEach(function (s) {
    orders.push({act: "buy", s: s, why: "종가가 200일선 위 (+" + (info[s].gap * 100).toFixed(1) + "%) · 3개월 " + (info[s].mom * 100).toFixed(0) + "%"});
  });
  return orders;
}

// 모멘텀 로테이션: 200일선·50일선 위 + 6개월 수익률 양수인 종목 중 상승률 순위. 상위 5개를 들고, 50일선 이탈이나 15위 밖이면 매도
function botSma(c, n) { if (c.length < n) return null; var t = 0; for (var i = c.length - n; i < c.length; i++) t += c[i]; return t / n; }
function _botDecideMomentum(st, data, day) {
  var ranked = [], rankOf = {}, info = {};
  BOT_W_LIST.concat(BOT_D_LIST).forEach(function (s) {
    if (info[s] !== undefined) return;
    var d = data[s]; info[s] = null;
    if (!d || d.c.length < 210 || d.dates[d.dates.length - 1] !== day) return;
    var n = d.c.length, p = d.c[n - 1], s50 = botSma(d.c, 50), s200 = botSma(d.c, 200), mom = p / d.c[n - 127] - 1;
    info[s] = {p: p, s50: s50, mom: mom, ok: p > s50 && p > s200 && mom > 0};
    if (info[s].ok) ranked.push(s);
  });
  ranked.sort(function (a, b) { return info[b].mom - info[a].mom; });
  ranked.forEach(function (s, i) { rankOf[s] = i + 1; });
  var orders = [], selling = 0;
  st.pos.forEach(function (p) {
    var f = info[p.s]; if (!f) return;
    var why = !f.ok ? (f.p <= f.s50 ? "50일선 이탈" : "추세 약화 (200일선·6개월 수익률)") : rankOf[p.s] > 15 ? "상승률 순위 " + rankOf[p.s] + "위로 밀림" : "";
    if (why) { orders.push({act: "sell", s: p.s, why: why}); selling++; }
  });
  var slots = BOT_M_MAX - st.pos.length + selling;
  ranked.filter(function (s) { return !st.pos.some(function (p) { return p.s === s; }); }).slice(0, Math.max(0, slots)).forEach(function (s) {
    orders.push({act: "buy", s: s, why: "상승률 " + rankOf[s] + "위 (6개월 +" + (info[s].mom * 100).toFixed(0) + "%) · 200·50일선 위"});
  });
  return orders;
}

// 하루 한 번 실행: 어제 정한 주문을 오늘 시가로 체결 → 종가로 평가 → 내일 주문 정하기
function botRun() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return "busy";
  try {
    var P = PropertiesService.getScriptProperties();
    if (P.getProperty("BOT_VER") !== BOT_VER) { resetBot(); P.setProperty("BOT_VER", BOT_VER); }      // 자금·규칙이 바뀌었으면 새로 시작
    var m = _botLoadAll(), set = {"SPY": 1, "KRW=X": 1};
    BOT_W_LIST.concat(BOT_D_LIST, BOT_V_LIST).forEach(function (s) { set[s] = 1; });
    ["w", "d", "m", "v"].forEach(function (id) { ((m[id + "_state"] || {}).pos || []).forEach(function (p) { set[p.s] = 1; }); });
    var data = _botFetch(Object.keys(set), "2y");
    if (!data.SPY || !data["KRW=X"]) return "no data";
    var spy = data.SPY, day = spy.dates[spy.dates.length - 1], spyC = spy.c[spy.c.length - 1];
    var fxD = data["KRW=X"], fx = fxD.c[fxD.c.length - 1];
    // 이번 주 장이 끝났는지 (금요일 장 마감 뒤 ~ 일요일)
    var now = new Date(), dow = Number(Utilities.formatDate(now, "America/New_York", "u")), hm = Number(Utilities.formatDate(now, "America/New_York", "HHmm"));
    var nowKey = botWeekKey(Utilities.formatDate(now, "America/New_York", "yyyy-MM-dd"));
    var weekDone = botWeekKey(day) < nowKey || dow >= 6 || (dow === 5 && hm >= 1610);
    var res = [], botMsgs = [], vSignals = [];

    if (m.v_state && m.v_state.rule !== "sma200") { ["state", "eq", "log", "closed"].forEach(function (k) { delete m["v_" + k]; }); }   // 규칙이 바뀐 레버리지봇만 새로 시작
    ["w", "d", "m", "v"].forEach(function (id) {
      var def = BOT_DEFS[id];
      var st = m[id + "_state"] || {start: "", cash: BOT_START_KRW, pos: [], pend: [], last: "", spy0: null, fx0: null};
      var eq = m[id + "_eq"] || [], log = m[id + "_log"] || [], closed = m[id + "_closed"] || [];
      if (st.last && day <= st.last) { res.push(id + ":already"); return; }
      var bar = function (s) { var d = data[s]; if (!d) return null; var n = d.c.length - 1; return d.dates[n] === day ? {open: d.o[n], close: d.c[n]} : null; };

      if (id === "v") st.rule = "sma200";
      if (!st.start) { st.start = day; st.spy0 = spyC; st.fx0 = fx; }
      else {
        st.pend.sort(function (a, b) { return (a.act === "sell" ? 0 : 1) - (b.act === "sell" ? 0 : 1); });
        st.pend.forEach(function (o) {
          var b = bar(o.s); if (!b) return;
          if (o.act === "sell") {
            var idx = -1; st.pos.forEach(function (p, i) { if (p.s === o.s) idx = i; });
            if (idx < 0) return;
            var p = st.pos[idx], px = b.open * (1 - BOT_FEE), pct = (px / p.avg - 1) * 100;
            st.cash += p.qty * px * fx;
            st.pos.splice(idx, 1);
            closed.push({s: p.s, i: p.d, o: day, r: Number(pct.toFixed(1))});
            log.push({d: day, t: "sell", q: Number(p.qty.toFixed(2)), s: p.s, px: Number(b.open.toFixed(2)), why: o.why + " · " + (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"});
          } else {
            if (st.pos.length >= def.max || st.pos.some(function (p) { return p.s === o.s; })) return;
            var cost = b.open * (1 + BOT_FEE), budget = Math.min(st.cash, (id === "v" ? _botEquity(st, fx) : BOT_START_KRW) / def.max);   // 레버리지봇만 복리(백테스트와 동일)
            var qty = Math.floor(budget / (cost * fx) * 10000) / 10000;      // 소수점 주식 허용
            if (qty * cost * fx < 50000) return;
            st.cash -= qty * cost * fx;
            st.pos.push({s: o.s, qty: qty, avg: cost, d: day, why: o.why, px: b.close, l1: o.l1 || null});
            log.push({d: day, t: "buy", q: Number(qty.toFixed(2)), s: o.s, px: Number(b.open.toFixed(2)), why: o.why});
          }
        });
      }
      st.pend = [];
      var total = st.cash;
      st.pos.forEach(function (p) { var b = bar(p.s); if (b) p.px = b.close; total += p.qty * p.px * fx; });
      eq.push({d: day, v: Math.round(total), b: Math.round(BOT_START_KRW * (spyC * fx) / (st.spy0 * st.fx0))});
      st.pend = id === "w" ? _botDecideWeekly(st, data, day, weekDone) : id === "m" ? _botDecideMomentum(st, data, day) : id === "v" ? _botDecideVidya(st, data, day) : _botDecideDaily(st, data, day);
      st.last = day; st.fx = fx;
      if (id === "v" && st.pend.length) vSignals = st.pend.slice();      // 레버리지봇은 신호가 뜬 순간(다음 장 시가에 체결 예정) 알림
      if (id === "w") {                                              // 주봉봇이 오늘 체결한 매매를 알림용으로 모아둠
        var todayTrades = log.filter(function (x) { return x.d === day; });
        if (todayTrades.length) botMsgs.push(todayTrades);
      }
      m[id + "_state"] = st; m[id + "_eq"] = eq.slice(-500); m[id + "_log"] = log.slice(-150); m[id + "_closed"] = closed.slice(-300);
      res.push(id + ":ok");
    });
    _botSaveAll(m);
    try {                                                            // 🤖 레버리지봇 매수·매도 신호 알림
      if (vSignals.length) {
        var vb = vSignals.filter(function (o) { return o.act === "buy"; }), vs = vSignals.filter(function (o) { return o.act === "sell"; });
        var vl = [];
        vb.forEach(function (o) { vl.push("🟢 매수 신호 " + o.s + " · " + o.why); });
        vs.forEach(function (o) { vl.push("🔴 매도 신호 " + o.s + " · " + o.why); });
        sendPush("📈 레버리지봇: 매수 " + vb.length + " · 매도 " + vs.length, vl.join("\n") + "\n(다음 장 시가에 가상 체결 · 레버리지 ETF는 변동성이 커요)");
      }
    } catch (e) { try { runLog("err", "레버리지봇 알림 실패: " + e.message); } catch (e2) {} }
    try {                                                            // 🤖 주봉봇이 무엇을 샀고 팔았는지 푸시
      if (botMsgs.length) {
        var tr = botMsgs[0], buys = tr.filter(function (x) { return x.t === "buy"; }), sells = tr.filter(function (x) { return x.t === "sell"; });
        var lines = [];
        buys.forEach(function (x) { lines.push("🟢 매수 " + x.s + " $" + x.px + " · " + x.why); });
        sells.forEach(function (x) { lines.push("🔴 매도 " + x.s + " $" + x.px + " · " + String(x.why).replace(" · ", ", ")); });
        sendPush("🤖 주봉봇 매매: 매수 " + buys.length + " · 매도 " + sells.length, lines.join("\n") + "\n(가상 매매예요)");
      }
    } catch (e) { try { runLog("err", "주봉봇 알림 실패: " + e.message); } catch (e2) {} }
    return day + " " + res.join(" ");
  } finally { lock.releaseLock(); }
}

function _botEquity(st, fx) { var t = st.cash; st.pos.forEach(function (p) { t += p.qty * p.px * fx; }); return t; }

function _botView(id, m) {
  var def = BOT_DEFS[id], st = m[id + "_state"];
  if (!st || !st.start) return {id: id, name: def.name, desc: def.desc, started: false, bt: id === "v" ? BOT_V_BT : null};
  var eq = m[id + "_eq"] || [], closed = m[id + "_closed"] || [], fx = st.fx || st.fx0, total = st.cash;
  var pos = st.pos.map(function (p) {
    total += p.qty * p.px * fx;
    return {s: p.s, q: Number(p.qty.toFixed(2)), avg: Number(p.avg.toFixed(2)), px: Number(p.px.toFixed(2)), pnl: Number(((p.px / p.avg - 1) * 100).toFixed(1)), d: p.d, why: p.why, l1: p.l1 || null};
  });
  var peak = 0, mdd = 0;
  eq.forEach(function (e) { if (e.v > peak) peak = e.v; if (peak) mdd = Math.max(mdd, (1 - e.v / peak) * 100); });
  var wins = closed.filter(function (c) { return c.r > 0; }), loss = closed.filter(function (c) { return c.r <= 0; });
  var avg = function (a) { return a.length ? a.reduce(function (x, c) { return x + c.r; }, 0) / a.length : 0; };
  var lastB = eq.length ? eq[eq.length - 1].b : BOT_START_KRW;
  return {id: id, name: def.name, desc: def.desc, started: true, start: st.start, last: st.last, startCash: BOT_START_KRW,
          fx: fx, total: Math.round(total), cash: Math.round(st.cash), max: def.max, fee: BOT_FEE * 100,
          ret: Number(((total / BOT_START_KRW - 1) * 100).toFixed(1)), spy: Number(((lastB / BOT_START_KRW - 1) * 100).toFixed(1)),
          pos: pos, pend: st.pend, eq: eq, log: (m[id + "_log"] || []).slice(-40).reverse(),
          stat: {n: closed.length, win: wins.length, avgWin: Number(avg(wins).toFixed(1)), avgLoss: Number(avg(loss).toFixed(1)), mdd: Number(mdd.toFixed(1))},
          bt: id === "v" ? BOT_V_BT : null};
}
function getBot(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var m = _botLoadAll();
  var bots = [_botView("w", m), _botView("d", m), _botView("m", m), _botView("v", m)];
  try { _botAttachCharts(bots, m); } catch (e) { try { runLog("err", "봇 차트 실패: " + e.message); } catch (e2) {} }
  return {ok: true, bots: bots};
}

// 보유 종목별 캔들 + 기준선 + 매매 표시 (10분 캐시)
var BOT_LINE = {w: {n: 100, label: "100일선(≈20주)"}, d: {n: 0, label: "손절선"}, m: {n: 50, label: "50일선"}, v: {n: 200, label: "200일선"}};
var BOT_V_SHOW = ["TQQQ", "SOXL"];
function _botAttachCharts(bots, m) {
  var need = {};
  bots.forEach(function (b) { if (b.started) b.pos.forEach(function (p) { need[p.s] = 1; }); });
  BOT_V_LIST.forEach(function (s) { need[s] = 1; });                 // 레버리지봇은 보유와 상관없이 4종 모두 차트
  var syms = Object.keys(need); if (!syms.length) return;
  var cache = CacheService.getScriptCache(), key = "botcand_" + syms.sort().join(",").slice(0, 200), data = null;
  try { var c = cache.get(key); if (c) data = JSON.parse(c); } catch (e) {}
  if (!data) {
    var raw = _botFetch(syms, "2y"); data = {};
    Object.keys(raw).forEach(function (s) {
      var d = raw[s], n = d.c.length, k0 = Math.max(0, n - 90), sma = {};
      [50, 100, 200].forEach(function (L) { sma[L] = d.c.map(function (_, i) { return i + 1 < L ? null : botSma(d.c.slice(0, i + 1).slice(-L), L); }).slice(k0); });
      data[s] = {t: d.dates.slice(k0), o: d.o.slice(k0).map(_r2), h: d.h.slice(k0).map(_r2), l: d.l.slice(k0).map(_r2), c: d.c.slice(k0).map(_r2),
                 s50: sma[50].map(_r2), s100: sma[100].map(_r2), s200: sma[200].map(_r2)};
    });
    try { cache.put(key, JSON.stringify(data), 600); } catch (e) {}
  }
  bots.forEach(function (b) {
    if (!b.started && b.id !== "v") return;
    var def = BOT_LINE[b.id], list = (b.pos || []).map(function (p) { return p.s; });
    if (b.id === "v") BOT_V_LIST.forEach(function (s) { if (list.indexOf(s) < 0) list.push(s); });
    var closedSyms = (b.log || []).map(function (x) { return x.s; });
    b.charts = list.filter(function (s) { return data[s]; }).map(function (s) {
      var d = data[s], pos = (b.pos || []).filter(function (p) { return p.s === s; })[0] || null;
      var marks = (b.log || []).filter(function (x) { return x.s === s && d.t.indexOf(x.d) >= 0; }).map(function (x) { return {d: x.d, t: x.t, px: x.px}; });
      var line = def.n ? d["s" + def.n] : null;
      var o = {s: s, t: d.t, o: d.o, h: d.h, l: d.l, c: d.c, line: line, lineLabel: def.label, marks: marks};
      if (b.id === "d" && pos && pos.l1) o.flat = pos.l1;
      if (pos) o.pos = pos;
      return o;
    });
  });
}
function _r2(x) { return x == null ? null : Number(Number(x).toFixed(2)); }

// 시뮬봇 트리거를 서버가 스스로 설치·시작 (10분 트리거에 얹혀 1시간에 한 번 확인) → setupBotTrigger 를 손으로 실행할 필요 없음
function _ensureBotTrigger() {
  var c = CacheService.getScriptCache();
  if (c.get("bot_trig_ok")) return;
  c.put("bot_trig_ok", "1", 3600);
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "botRun"; });
  if (!has) ScriptApp.newTrigger("botRun").timeBased().everyDays(1).atHour(8).create();
  var P = PropertiesService.getScriptProperties();
  if (P.getProperty("BOT_VER") !== BOT_VER) { botRun(); }                  // 아직 한 번도 안 돌았거나 규칙이 바뀐 경우 바로 시작
}
function setupBotTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "botRun") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("botRun").timeBased().everyDays(1).atHour(8).create();
  Logger.log("시뮬봇 시작: " + botRun());
}
// 처음부터 다시 시작 (두 봇의 기록이 모두 지워져요)
function resetBot() { var sh = _botSheet(); if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent(); Logger.log("봇 기록을 지웠어요"); }