// ==========================================================
// Backtest.gs - 앱에서 쓰는 백테스트 (과거 신호를 그대로 돌려서 성과 비교)
// Code.gs의 doPost에 한 줄 추가가 필요해요:
//   if (data.action === "backtest") return json(backtestForWeb(token, data.ticker, data.years));
// ==========================================================
var BT_EMPTY_WEEKLY = {closes: [], opens: [], highs: [], lows: []};

function backtestForWeb(token, ticker, years) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  ticker = String(ticker || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(ticker)) return {ok: false, msg: "티커 형식이 올바르지 않아요"};
  years = Math.min(10, Math.max(1, Number(years) || 5));
  try {
    var url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker) + "?range=10y&interval=1d";
    var resp = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
    if (resp.getResponseCode() !== 200) return {ok: false, msg: ticker + " 데이터를 찾을 수 없어요. 티커를 확인하세요."};
    var all = processYahooData(JSON.parse(resp.getContentText()));
    return backtestCore(all, years, ticker);
  } catch (e) {
    return {ok: false, msg: ticker + " 백테스트 중 오류: " + e.message};
  }
}

function btHead(d, end) {
  return {
    opens: d.opens.slice(0, end), closes: d.closes.slice(0, end), highs: d.highs.slice(0, end),
    lows: d.lows.slice(0, end), volumes: d.volumes.slice(0, end), dates: d.dates.slice(0, end),
    timestamps: d.timestamps.slice(0, end)
  };
}
function btHeadHA(ha, end) {
  return {closes: ha.closes.slice(0, end), opens: ha.opens.slice(0, end), highs: ha.highs.slice(0, end), lows: ha.lows.slice(0, end)};
}
function btDate(ts) { return Utilities.formatDate(new Date(ts * 1000), "America/New_York", "yyyy-MM-dd"); }

// 신호 배열 등 공통 준비물
function btPrepare(d, ticker) {
  var n = d.closes.length;
  var ha = calculateHeikinAshi_GAS(d);
  var ma20 = [];
  for (var i = 0; i < n; i++) ma20.push(i >= 19 ? calculateMA(d.closes.slice(i - 19, i + 1), 20) : null);
  var ex = calculateIsExtremeLowArray(d);

  var _fl = haSignalFlags(d, ha);
  var buy = [], sell = [], clover = [], haGreen = [];
  for (var k = 0; k < n; k++) {
    var g = ha.closes[k] > ha.opens[k];
    var pg = k > 0 ? ha.closes[k - 1] > ha.opens[k - 1] : false;
    var m = ma20[k];
    haGreen.push(g);
    buy.push(k >= 20 && _fl.buyEv[k]);
    sell.push(k >= 20 && _fl.sellEv[k]);
    var hadEx = false;
    for (var q = Math.max(0, k - 4); q <= k; q++) { if (ex[q]) { hadEx = true; break; } }
    clover.push(k >= 20 && hadEx && g && !pg);
  }

  var ctxCache = {};
  function ctxAt(i) {
    if (!ctxCache[i]) ctxCache[i] = getSignalContext(btHead(d, i + 1), null, btHeadHA(ha, i + 1), BT_EMPTY_WEEKLY, ticker);
    return ctxCache[i];
  }
  // 주봉 하이킨아시: 그 주의 마지막 봉에서만 판단 (wkEnd), 그 주가 양봉인지 (wkGreen)
  var wkEnd = [], wkGreen = [];
  for (var z = 0; z < n; z++) { wkEnd.push(false); wkGreen.push(false); }
  if (typeof botWeeklyHa === "function") {
    var dts = d.timestamps.map(function (t) { return btDate(t); });
    var lastFri = new Date(dts[n - 1] + "T12:00:00Z").getUTCDay() === 5;
    var wk = botWeeklyHa(dts, d.opens, d.highs, d.lows, d.closes, lastFri);
    wk.end.forEach(function (e, j) { wkEnd[e] = true; wkGreen[e] = wk.green[j]; });
  }
  return {d: d, n: n, ha: ha, ma20: ma20, buy: buy, sell: sell, clover: clover, haGreen: haGreen, ctxAt: ctxAt, wkEnd: wkEnd, wkGreen: wkGreen};
}

// 전략 정의: sims = 사고 팔기형, holds = 사서 계속 보유형
function btDefs(p) {
  var d = p.d, ma20 = p.ma20, buy = p.buy, sell = p.sell, clover = p.clover, haGreen = p.haGreen, ctxAt = p.ctxAt;

  var sellExit = function (i, pos) { return sell[i] ? "매도 신호" : null; };
  var reboundExit = function (i, pos) {
    if (d.closes[i] >= ma20[i]) return "목표(20일선)";
    if (d.closes[i] < pos.info.low) return "손절(저점 이탈)";
    if (i - pos.i >= 10) return "시간(10일)";
    return null;
  };
  var slowExit3 = function (i, pos) { return (sell[i] && i - pos.i >= 3) ? "매도 신호(3일 후)" : null; };
  var twoRedExit = function (i, pos) {
    if (i > pos.i && !haGreen[i] && !haGreen[i - 1] && d.closes[i] < ma20[i]) return "음봉 2연속";
    return null;
  };
  var twoRedStopExit = function (i, pos) {
    if (d.closes[i] < pos.info.low) return "손절(저점 이탈)";
    return twoRedExit(i, pos);
  };
  var cl = function (i) { return clover[i] ? {low: d.lows[i]} : null; };
  var clStrong = function (i) { return (clover[i] && ctxAt(i).clover.strong) ? {low: d.lows[i]} : null; };

  var sims = [
    {key: "base", short: "① 기본", name: "① 기본: 신호대로 사고 팔기",
     desc: "매수 신호가 뜨면 사고, 매도 신호가 뜨면 팝니다. (매수 신호 = 평균 캔들이 하락→상승으로 바뀌고 주가가 20일 평균선 위일 때, 매도 신호 = 상승→하락으로 바뀌고 20일 평균선 아래일 때)",
     enter: function (i) { return buy[i] ? {} : null; }, exit: sellExit},
    {key: "side", short: "② 횡보장 거르기", name: "② 기본 + 횡보장 거르기",
     desc: "①과 같지만, 방향 없이 출렁이는 '횡보장'에서 뜬 매수 신호는 건너뜁니다.",
     enter: function (i) { return (buy[i] && !ctxAt(i).sideways) ? {} : null; }, exit: sellExit},
    {key: "cl1", short: "③ 저점매수", name: "③ 저점매수 → 매도 신호에 팔기",
     desc: "많이 빠진 뒤 처음 반등하는 '저점매수' 신호에 사고, ①의 매도 신호가 뜨면 팝니다.",
     enter: cl, exit: sellExit, clover: true},
    {key: "cl2", short: "④ 강한 저점매수", name: "④ 강한 저점매수만 → 매도 신호에 팔기",
     desc: "③에서 반등 확인 조건을 다 채운 '강한' 저점매수만 삽니다.",
     enter: clStrong, exit: sellExit, clover: true},
    {key: "cl3", short: "⑤ 저점매수+반등청산", name: "⑤ 저점매수 → 반등 목표/손절로 팔기",
     desc: "저점매수에 사고, 주가가 20일선에 닿으면 이익 실현, 신호 당일 저점을 종가로 깨면 손절, 10거래일이 지나면 정리합니다.",
     enter: cl, exit: reboundExit, clover: true},
    {key: "cl4", short: "⑥ 강한 저점매수+반등청산", name: "⑥ 강한 저점매수만 → 반등 목표/손절로 팔기",
     desc: "⑤에서 '강한' 저점매수만 삽니다.",
     enter: clStrong, exit: reboundExit, clover: true},
    {key: "cl5", short: "⑦ 최소 3일 보유", name: "⑦ 저점매수 → 최소 3일은 들고 있다가 매도 신호에 팔기",
     desc: "③과 같지만 사고 나서 3거래일 안에 뜬 매도 신호는 무시합니다. 반등 초기의 잔흔들림에 바로 팔리는 걸 줄이려는 규칙이에요.",
     enter: cl, exit: slowExit3, clover: true},
    {key: "cl6", short: "⑧ 음봉 2연속", name: "⑧ 저점매수 → 평균 캔들 음봉이 2번 연속일 때 팔기",
     desc: "매도 신호 대신, 평균 캔들(하이킨아시)이 이틀 연속 음봉이고 주가가 20일선 아래일 때만 팝니다. 매도 신호보다 둔하게 반응해요.",
     enter: cl, exit: twoRedExit, clover: true},
    {key: "cl7", short: "⑨ 음봉 2연속+손절", name: "⑨ 저점매수 → 음봉 2연속 또는 신호일 저점 이탈 시 팔기",
     desc: "⑧에 안전장치를 더했어요. 신호 당일 저점을 종가로 깨면 바로 손절합니다.",
     enter: cl, exit: twoRedStopExit, clover: true},
    {key: "wha", short: "⑬ 주봉 양봉 보유", name: "⑬ 주봉 하이킨아시: 양봉이면 보유, 음봉이면 매도",
     desc: "한 주가 끝났을 때 주봉 평균 캔들(하이킨아시)이 양봉이면 사서 들고 있고, 음봉으로 바뀌면 팝니다. 큰 흐름만 따라가서 매매가 적어요.",
     enter: function (i) { return (p.wkEnd[i] && p.wkGreen[i]) ? {} : null; },
     exit: function (i, pos) { return (p.wkEnd[i] && !p.wkGreen[i]) ? "주봉 음봉" : null; }},
    {key: "w1234", short: "⑭ 1234(W자)", name: "⑭ 1234(W자): 두 번째 바닥이 더 높을 때 매수",
     desc: "하락(1번 바닥) → 반등(2번) → 다시 눌림(3번)인데 첫 바닥을 안 깨고 → 다시 양봉(4번)이 되면 삽니다. 종가가 첫 바닥 아래로 내려가면 손절, 평균 캔들 음봉이 2번 연속이면 팝니다.",
     enter: function (i) { var w = (typeof botW1234 === "function") ? botW1234(haGreen, d.lows, i) : null; return w ? {low: w.l1} : null; },
     exit: function (i, pos) {
       if (d.closes[i] < pos.info.low) return "손절(첫 바닥 이탈)";
       if (i > pos.i && !haGreen[i] && !haGreen[i - 1]) return "음봉 2연속";
       return null;
     }}
  ];
  var holds = [
    {key: "hold1", short: "⑩ 첫 저점매수 후 보유", name: "⑩ 첫 저점매수에 사서 계속 보유 (안 팔기)",
     desc: "처음으로 저점매수 신호가 뜬 날 한 번만 사고, 끝까지 팔지 않습니다.",
     enter: function (i) { return clover[i]; }, addMore: false, clover: true},
    {key: "holdAll", short: "⑪ 저점매수마다 추가+보유", name: "⑪ 저점매수가 뜰 때마다 사 모으며 계속 보유",
     desc: "저점매수 신호가 뜰 때마다 같은 금액씩 추가로 사고, 끝까지 팔지 않습니다. (분할매수 장투)",
     enter: function (i) { return clover[i]; }, addMore: true, clover: true},
    {key: "holdStrong", short: "⑫ 강한 저점매수 추가+보유", name: "⑫ 강한 저점매수가 뜰 때마다 사 모으며 계속 보유",
     desc: "⑪과 같지만 '강한' 저점매수 신호에서만 삽니다.",
     enter: function (i) { return clover[i] && ctxAt(i).clover.strong; }, addMore: true, clover: true}
  ];
  return {sims: sims, holds: holds};
}

function backtestCore(all, years, ticker) {
  if (!all || all.closes.length < 150) return {ok: false, msg: ticker + " 데이터가 부족해서 백테스트가 어려워요."};
  var d = all, n = d.closes.length;
  var start = Math.max(60, n - Math.round(years * 252));
  var p = btPrepare(d, ticker);
  var defs = btDefs(p);

  var results = defs.sims.map(function (def) { return btSimulate(d, start, def); });
  defs.holds.forEach(function (h) {
    results.push(btHoldSim(d, start, h.enter, h.addMore, h.key, h.short, h.name, h.desc));
  });

  // 매수 후 보유 (비교용)
  var bhEq = 1, bhPeak = 1, bhMdd = 0;
  for (var j = start + 1; j < n; j++) {
    bhEq *= d.closes[j] / d.closes[j - 1];
    if (bhEq > bhPeak) bhPeak = bhEq;
    var dd = bhEq / bhPeak - 1;
    if (dd < bhMdd) bhMdd = dd;
  }

  return {
    ok: true, ticker: ticker, years: years,
    from: btDate(d.timestamps[start]), to: btDate(d.timestamps[n - 1]),
    bh: {total: (bhEq - 1) * 100, mdd: bhMdd * 100},
    series: {
      closes: d.closes.slice(start).map(function (x) { return Math.round(x * 100) / 100; }),
      ts: d.timestamps.slice(start)
    },
    strategies: results
  };
}

function btSimulate(d, start, def) {
  var n = d.closes.length, pos = null, trades = [], eq = 1, peak = 1, mdd = 0;
  for (var i = start; i < n; i++) {
    if (pos && i > pos.i) eq *= d.closes[i] / d.closes[i - 1];
    if (pos) {
      var why = def.exit(i, pos);
      if (why) {
        trades.push(btTrade(d, pos, i, why, false, start));
        pos = null;
      }
    }
    if (!pos) {
      var info = def.enter(i);
      if (info) pos = {i: i, info: info};
    }
    if (eq > peak) peak = eq;
    var dd = eq / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  if (pos) trades.push(btTrade(d, pos, n - 1, "보유중", true, start));

  var wins = trades.filter(function (t) { return t.ret > 0; });
  var loses = trades.filter(function (t) { return t.ret <= 0; });
  var avg = function (a, f) { return a.length ? a.reduce(function (s, x) { return s + f(x); }, 0) / a.length : null; };
  return {
    key: def.key, short: def.short, name: def.name, desc: def.desc,
    n: trades.length,
    win: trades.length ? wins.length / trades.length * 100 : null,
    avg: avg(trades, function (t) { return t.ret; }),
    avgWin: avg(wins, function (t) { return t.ret; }),
    avgLoss: avg(loses, function (t) { return t.ret; }),
    avgDays: avg(trades, function (t) { return t.days; }),
    total: (eq - 1) * 100,
    mdd: mdd * 100,
    trades: trades
  };
}

function btTrade(d, pos, exitIdx, why, open, start) {
  var ep = d.closes[pos.i], xp = d.closes[exitIdx];
  return {
    i: pos.i - start, o: exitIdx - start,
    inDate: btDate(d.timestamps[pos.i]), outDate: btDate(d.timestamps[exitIdx]),
    inPx: ep, outPx: xp, ret: (xp / ep - 1) * 100, days: exitIdx - pos.i, why: why, open: open
  };
}

// 사기만 하고 끝까지 보유하는 전략 (mode all = 신호마다 추가 매수, 같은 금액씩)
function btHoldSim(d, start, enterFn, addMore, key, short, name, desc) {
  var n = d.closes.length, lots = [];
  for (var i = start; i < n; i++) {
    if (enterFn(i) && (addMore || lots.length === 0)) lots.push(i);
  }
  var trades = lots.map(function (li) { return btTrade(d, {i: li}, n - 1, "보유중", true, start); });
  var eqPeak = 1, mdd = 0, total = 0, sumInv = 0;
  if (lots.length) {
    for (var t = lots[0]; t < n; t++) {
      var v = 0, cnt = 0;
      for (var k = 0; k < lots.length && lots[k] <= t; k++) { v += d.closes[t] / d.closes[lots[k]]; cnt++; }
      var e = v / cnt;
      if (e > eqPeak) eqPeak = e;
      var dd = e / eqPeak - 1;
      if (dd < mdd) mdd = dd;
      if (t === n - 1) total = (e - 1) * 100;
    }
    lots.forEach(function (li) { sumInv += 1 / d.closes[li]; });
  }
  var wins = trades.filter(function (x) { return x.ret > 0; });
  var loses = trades.filter(function (x) { return x.ret <= 0; });
  var avg = function (a, f) { return a.length ? a.reduce(function (s, x) { return s + f(x); }, 0) / a.length : null; };
  var avgCost = lots.length ? lots.length / sumInv : null;
  return {
    key: key, short: short, name: name,
    desc: desc + (avgCost ? " 평균 매수가 " + avgCost.toFixed(2) + "$ → 마지막 종가 " + d.closes[n - 1].toFixed(2) + "$ (매수 " + lots.length + "번)." : " 이 기간에는 신호가 없었어요."),
    n: trades.length,
    win: trades.length ? wins.length / trades.length * 100 : null,
    avg: avg(trades, function (x) { return x.ret; }),
    avgWin: avg(wins, function (x) { return x.ret; }),
    avgLoss: avg(loses, function (x) { return x.ret; }),
    avgDays: avg(trades, function (x) { return x.days; }),
    total: total, mdd: mdd * 100, hold: true,
    trades: trades
  };
}