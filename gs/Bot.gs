// ===== Bot.gs : 🤖 시뮬봇 2개 (가상 1,000만원씩, 신호를 실제처럼 따라가 보는 봇) =====
//  · 주봉봇 : 주봉 하이킨아시가 양봉이면 들고, 음봉이 되면 팝니다.
//  · 일봉봇 : 1234(W자) 매매. 두 번째 바닥이 첫 바닥보다 높게 끝나고 다시 양봉이 되면 사고,
//             첫 바닥을 종가로 깨면 손절, 하이킨아시 음봉 2연속이면 팝니다.
// 처음 한 번: setupBotTrigger 실행 (매일 아침 8시쯤 자동 기록). 규칙을 바꾸면 resetBot 으로 새로 시작하세요.
var BOT_START_KRW = 10000000;  // 봇마다 시작 가상 자금 (원)
var BOT_FEE       = 0.0025;    // 수수료+환전+슬리피지 (살 때·팔 때 각각 0.25%)
var BOT_SHEET     = "bot";

// 주봉봇이 훑어보는 종목 (지수·반도체 ETF + 대형 우량주, 업종을 섞음). 20종목을 보되 동시에는 최대 5종목 × 200만원만 보유
var BOT_W_MAX = 5;
var BOT_W_LIST = ["QQQ", "SMH", "NVDA", "MSFT", "GOOGL", "AMZN", "META", "AVGO", "LLY", "JPM",
  "AAPL", "TSLA", "TSM", "AMD", "NFLX", "COST", "V", "UNH", "XOM", "BRK-B"];
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
  d: {name: "일봉봇 (1234·W자)", desc: "W자 두 번째 바닥이 첫 바닥보다 높고 다시 양봉이 되면 매수", max: BOT_D_MAX}
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
  var sh = _botSheet(), keys = Object.keys(m).filter(function (k) { return /^(w|d)_(state|eq|log|closed)$/.test(k); }).sort();
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

// 하루 한 번 실행: 어제 정한 주문을 오늘 시가로 체결 → 종가로 평가 → 내일 주문 정하기
function botRun() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return "busy";
  try {
    var m = _botLoadAll(), set = {"SPY": 1, "KRW=X": 1};
    BOT_W_LIST.concat(BOT_D_LIST).forEach(function (s) { set[s] = 1; });
    ["w", "d"].forEach(function (id) { ((m[id + "_state"] || {}).pos || []).forEach(function (p) { set[p.s] = 1; }); });
    var data = _botFetch(Object.keys(set), "2y");
    if (!data.SPY || !data["KRW=X"]) return "no data";
    var spy = data.SPY, day = spy.dates[spy.dates.length - 1], spyC = spy.c[spy.c.length - 1];
    var fxD = data["KRW=X"], fx = fxD.c[fxD.c.length - 1];
    // 이번 주 장이 끝났는지 (금요일 장 마감 뒤 ~ 일요일)
    var now = new Date(), dow = Number(Utilities.formatDate(now, "America/New_York", "u")), hm = Number(Utilities.formatDate(now, "America/New_York", "HHmm"));
    var nowKey = botWeekKey(Utilities.formatDate(now, "America/New_York", "yyyy-MM-dd"));
    var weekDone = botWeekKey(day) < nowKey || dow >= 6 || (dow === 5 && hm >= 1610);
    var res = [];

    ["w", "d"].forEach(function (id) {
      var def = BOT_DEFS[id];
      var st = m[id + "_state"] || {start: "", cash: BOT_START_KRW, pos: [], pend: [], last: "", spy0: null, fx0: null};
      var eq = m[id + "_eq"] || [], log = m[id + "_log"] || [], closed = m[id + "_closed"] || [];
      if (st.last && day <= st.last) { res.push(id + ":already"); return; }
      var bar = function (s) { var d = data[s]; if (!d) return null; var n = d.c.length - 1; return d.dates[n] === day ? {open: d.o[n], close: d.c[n]} : null; };

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
            var cost = b.open * (1 + BOT_FEE), budget = Math.min(st.cash, BOT_START_KRW / def.max);
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
      st.pend = id === "w" ? _botDecideWeekly(st, data, day, weekDone) : _botDecideDaily(st, data, day);
      st.last = day; st.fx = fx;
      m[id + "_state"] = st; m[id + "_eq"] = eq.slice(-500); m[id + "_log"] = log.slice(-150); m[id + "_closed"] = closed.slice(-300);
      res.push(id + ":ok");
    });
    _botSaveAll(m);
    return day + " " + res.join(" ");
  } finally { lock.releaseLock(); }
}

function _botView(id, m) {
  var def = BOT_DEFS[id], st = m[id + "_state"];
  if (!st || !st.start) return {id: id, name: def.name, desc: def.desc, started: false};
  var eq = m[id + "_eq"] || [], closed = m[id + "_closed"] || [], fx = st.fx || st.fx0, total = st.cash;
  var pos = st.pos.map(function (p) {
    total += p.qty * p.px * fx;
    return {s: p.s, q: Number(p.qty.toFixed(2)), avg: Number(p.avg.toFixed(2)), px: Number(p.px.toFixed(2)), pnl: Number(((p.px / p.avg - 1) * 100).toFixed(1)), d: p.d, why: p.why};
  });
  var peak = 0, mdd = 0;
  eq.forEach(function (e) { if (e.v > peak) peak = e.v; if (peak) mdd = Math.max(mdd, (1 - e.v / peak) * 100); });
  var wins = closed.filter(function (c) { return c.r > 0; }), loss = closed.filter(function (c) { return c.r <= 0; });
  var avg = function (a) { return a.length ? a.reduce(function (x, c) { return x + c.r; }, 0) / a.length : 0; };
  var lastB = eq.length ? eq[eq.length - 1].b : BOT_START_KRW;
  return {id: id, name: def.name, desc: def.desc, started: true, start: st.start, last: st.last, startCash: BOT_START_KRW,
          total: Math.round(total), cash: Math.round(st.cash), max: def.max, fee: BOT_FEE * 100,
          ret: Number(((total / BOT_START_KRW - 1) * 100).toFixed(1)), spy: Number(((lastB / BOT_START_KRW - 1) * 100).toFixed(1)),
          pos: pos, pend: st.pend, eq: eq, log: (m[id + "_log"] || []).slice(-40).reverse(),
          stat: {n: closed.length, win: wins.length, avgWin: Number(avg(wins).toFixed(1)), avgLoss: Number(avg(loss).toFixed(1)), mdd: Number(mdd.toFixed(1))}};
}
function getBot(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var m = _botLoadAll();
  return {ok: true, bots: [_botView("w", m), _botView("d", m)]};
}

function setupBotTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "botRun") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("botRun").timeBased().everyDays(1).atHour(8).create();
  Logger.log("시뮬봇 시작: " + botRun());
}
// 처음부터 다시 시작 (두 봇의 기록이 모두 지워져요)
function resetBot() { var sh = _botSheet(); if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent(); Logger.log("봇 기록을 지웠어요"); }