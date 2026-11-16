// ===== Market.gs : 🌡️ 시장 점수 + PPI(물가) + 🪙 코인 시세 =====
// 시장 점수 = 주식에 영향을 주는 8가지를 각각 0~100점으로 매겨 평균낸 값.
// 각 점수는 "지난 5년 중 지금이 몇 번째로 좋은가(백분위)"라서 50점이 평균적인 시장이에요.

function _mkParse(resp) {
  try {
    if (resp.getResponseCode() !== 200) return null;
    var r = JSON.parse(resp.getContentText()).chart.result[0], q = r.indicators.quote[0], ts = r.timestamp;
    var out = {c: [], o: [], h: [], l: [], t: [], price: (r.meta && r.meta.regularMarketPrice) || null, off: (r.meta && r.meta.gmtoffset) || 0};
    for (var i = 0; i < ts.length; i++) {
      if (q.close[i] == null) continue;
      out.c.push(q.close[i]); out.t.push(ts[i]);
      out.o.push(q.open[i] == null ? q.close[i] : q.open[i]);
      out.h.push(q.high[i] == null ? q.close[i] : q.high[i]);
      out.l.push(q.low[i] == null ? q.close[i] : q.low[i]);
    }
    return out.c.length ? out : null;
  } catch (e) { return null; }
}
// 값 v가 배열 안에서 몇 %보다 큰지 (0~100)
function _mkPct(arr, v) {
  var n = 0, k = 0;
  arr.forEach(function (x) { if (x == null || isNaN(x)) return; n++; if (x < v) k++; });
  return n ? k / n * 100 : 50;
}
function _mkSma(c, i, p) { if (i < p - 1) return null; var s = 0; for (var k = i - p + 1; k <= i; k++) s += c[k]; return s / p; }
// 두 시세를 날짜(일) 기준으로 맞춰 비율 배열을 만듦
function _mkRatio(a, b) {
  var m = {}, out = [];
  b.t.forEach(function (t, i) { m[Math.floor(t / 86400)] = b.c[i]; });
  a.t.forEach(function (t, i) { var v = m[Math.floor(t / 86400)]; if (v) out.push(a.c[i] / v); });
  return out;
}
function _mkFred(resp) {                                  // FRED CSV → [{d: "yyyy-MM-dd", v: 숫자}]
  try {
    if (resp.getResponseCode() !== 200) return null;
    var out = [];
    resp.getContentText().split("\n").slice(1).forEach(function (ln) {
      var p = ln.trim().split(","), v = Number(p[1]);
      if (p.length >= 2 && p[1] !== "." && !isNaN(v)) out.push({d: p[0], v: v});
    });
    return out.length > 24 ? out : null;
  } catch (e) { return null; }
}
function _mkYoY(s) { var out = []; for (var i = 12; i < s.length; i++) out.push((s[i].v / s[i - 12].v - 1) * 100); return out; }

function marketData() {
  var cache = CacheService.getScriptCache(), hit = cache.get("mkt_v1");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var syms = ["SPY", "^VIX", "^TNX", "^IRX", "HYG", "IEF", "DX-Y.NYB", "RSP"];
  var reqs = syms.map(function (s) { return {url: "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=5y&interval=1d", muteHttpExceptions: true}; });
  ["PPIFIS", "CPIAUCSL"].forEach(function (id) { reqs.push({url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + id + "&cosd=2010-01-01", muteHttpExceptions: true}); });
  var resps;
  try { resps = UrlFetchApp.fetchAll(reqs); } catch (e) { return {ok: false, msg: "시장 데이터를 불러오지 못했어요"}; }
  var D = {};
  syms.forEach(function (s, i) { D[s] = _mkParse(resps[i]); });
  var ppi = _mkFred(resps[syms.length]), cpi = _mkFred(resps[syms.length + 1]);
  var items = [], L = function (a) { return a[a.length - 1]; };
  var add = function (name, score, val, good, tip) { items.push({name: name, score: Math.round(Math.max(0, Math.min(100, score))), val: val, good: good, tip: tip}); };
  var chg = function (c, back) { var out = []; for (var i = back; i < c.length; i++) out.push(c[i] - c[i - back]); return out; };
  var chgPct = function (c, back) { var out = []; for (var i = back; i < c.length; i++) out.push((c[i] / c[i - back] - 1) * 100); return out; };

  if (D.SPY) {
    var c = D.SPY.c, x = [];
    for (var i = 199; i < c.length; i++) x.push((c[i] / _mkSma(c, i, 200) - 1) * 100);
    add("📈 주가 추세", _mkPct(x, L(x)), "S&P500이 200일선보다 " + (L(x) >= 0 ? "+" : "") + L(x).toFixed(1) + "%", "높을수록 좋음", "지수가 장기 평균선(200일) 위에 있으면 상승 흐름이에요.");
  }
  if (D["^VIX"]) {
    var v = D["^VIX"].c;
    add("😨 변동성(VIX)", 100 - _mkPct(v, L(v)), "VIX " + L(v).toFixed(1), "낮을수록 좋음", "시장이 얼마나 불안해하는지예요. 보통 20 아래면 평온, 30 위면 공포예요.");
  }
  if (D["^TNX"]) {
    var t = D["^TNX"].c, tc = chg(t, 63);
    add("🏦 금리(미 10년 국채)", 100 - _mkPct(tc, L(tc)), L(t).toFixed(2) + "% (3달 전보다 " + (L(tc) >= 0 ? "+" : "") + L(tc).toFixed(2) + ")", "내려갈수록 좋음", "금리가 오르면 주식(특히 성장주) 값이 눌리고, 내리면 숨통이 트여요.");
  }
  if (D["^TNX"] && D["^IRX"]) {
    var a = D["^TNX"], b = D["^IRX"], m = {}, diff = [];
    b.t.forEach(function (tt, i) { m[Math.floor(tt / 86400)] = b.c[i]; });
    a.t.forEach(function (tt, i) { var bv = m[Math.floor(tt / 86400)]; if (bv != null) diff.push(a.c[i] - bv); });
    if (diff.length) add("📐 장단기 금리차", _mkPct(diff, L(diff)), "10년 − 3개월 = " + (L(diff) >= 0 ? "+" : "") + L(diff).toFixed(2) + "%p", "플러스일수록 좋음", "장기 금리가 단기보다 낮으면(마이너스) 경기 침체 걱정 신호로 봐요.");
  }
  if (D.HYG && D.IEF) {
    var r = _mkRatio(D.HYG, D.IEF), rx = [];
    for (var j = 199; j < r.length; j++) rx.push((r[j] / _mkSma(r, j, 200) - 1) * 100);
    if (rx.length) add("💳 신용(하이일드 채권)", _mkPct(rx, L(rx)), "위험 채권이 국채보다 " + (L(rx) >= 0 ? "강함" : "약함") + " (" + (L(rx) >= 0 ? "+" : "") + L(rx).toFixed(1) + "%)", "강할수록 좋음", "투자자들이 위험한 회사채를 사고 있으면 돈이 겁먹지 않았다는 뜻이에요.");
  }
  if (D["DX-Y.NYB"]) {
    var dx = D["DX-Y.NYB"].c, dc = chgPct(dx, 63);
    add("💵 달러", 100 - _mkPct(dc, L(dc)), "달러지수 " + L(dx).toFixed(1) + " (3달 " + (L(dc) >= 0 ? "+" : "") + L(dc).toFixed(1) + "%)", "약해질수록 좋음", "달러가 빠르게 강해지면 보통 위험자산(주식·코인)에서 돈이 빠져요.");
  }
  if (D.RSP && D.SPY) {
    var br = _mkRatio(D.RSP, D.SPY), bc = chgPct(br, 63);
    if (bc.length) add("🧺 시장 폭", _mkPct(bc, L(bc)), "평범한 종목들이 지수보다 3달 " + (L(bc) >= 0 ? "+" : "") + L(bc).toFixed(1) + "%", "넓을수록 좋음", "몇몇 대형주만 오르는지, 여러 종목이 같이 오르는지예요. 같이 오를수록 건강해요.");
  }
  var ppiOut = null;
  if (ppi) {
    var py = _mkYoY(ppi), n = ppi.length, mom = (ppi[n - 1].v / ppi[n - 2].v - 1) * 100;
    var cy = cpi ? _mkYoY(cpi) : null;
    add("🏭 물가(PPI)", 100 - _mkPct(py, L(py)), "생산자물가 1년 전보다 " + (L(py) >= 0 ? "+" : "") + L(py).toFixed(1) + "%", "낮을수록 좋음", "물가가 높으면 금리를 못 내려서 주식에 부담이에요.");
    ppiOut = {month: ppi[n - 1].d.slice(0, 7), yoy: Number(L(py).toFixed(1)), prevYoy: Number(py[py.length - 2].toFixed(1)), mom: Number(mom.toFixed(1)),
              cpiMonth: cpi ? L(cpi).d.slice(0, 7) : "", cpiYoy: cy ? Number(L(cy).toFixed(1)) : null,
              hist: py.slice(-24).map(function (x) { return Number(x.toFixed(1)); })};
  }
  if (!items.length) return {ok: false, msg: "시장 데이터를 불러오지 못했어요"};
  var total = Math.round(items.reduce(function (s, x) { return s + x.score; }, 0) / items.length);
  var label = total >= 65 ? "평균보다 좋은 시장" : total >= 55 ? "평균보다 조금 좋은 시장" : total >= 45 ? "평균 수준의 시장" : total >= 35 ? "평균보다 조금 나쁜 시장" : "평균보다 나쁜 시장";
  var out = {ok: true, total: total, diff: total - 50, label: label, items: items, ppi: ppiOut,
             updated: Utilities.formatDate(new Date(), "Asia/Seoul", "MM/dd HH:mm")};
  try { cache.put("mkt_v1", JSON.stringify(out), 1800); } catch (e) {}
  return out;
}
function getMarket(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  return marketData();
}

// ---------- 🪙 코인 ----------
var COIN_LIST = [["BTC-USD", "비트코인", "BTC"], ["ETH-USD", "이더리움", "ETH"], ["SOL-USD", "솔라나", "SOL"], ["XRP-USD", "리플", "XRP"], ["DOGE-USD", "도지코인", "DOGE"]];
function getCoins(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var cache = CacheService.getScriptCache(), hit = cache.get("coin_v1");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var reqs = COIN_LIST.map(function (c) { return {url: "https://query1.finance.yahoo.com/v8/finance/chart/" + c[0] + "?range=1y&interval=1d", muteHttpExceptions: true}; });
  reqs.push({url: "https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?range=5d&interval=1d", muteHttpExceptions: true});
  var resps;
  try { resps = UrlFetchApp.fetchAll(reqs); } catch (e) { return {ok: false, msg: "코인 시세를 불러오지 못했어요"}; }
  var fxD = _mkParse(resps[COIN_LIST.length]), fx = fxD ? (fxD.price || fxD.c[fxD.c.length - 1]) : null;
  var coins = [];
  COIN_LIST.forEach(function (c, k) {
    var d = _mkParse(resps[k]);
    if (!d || d.c.length < 40) return;
    var n = d.c.length, px = d.price || d.c[n - 1];
    var back = function (days) { return n - 1 - days >= 0 ? (px / d.c[n - 1 - days] - 1) * 100 : null; };
    var hi = Math.max.apply(null, d.h);
    var o = {sym: c[2], name: c[1], usd: px, krw: fx ? Math.round(px * fx) : null,
             d1: back(1), d7: back(7), d30: back(30), fromHigh: (px / hi - 1) * 100,
             spark: d.c.slice(-60).map(function (x) { return Number(x.toPrecision(6)); })};
    if (typeof botHaGreen === "function") {
      var g = botHaGreen(d.o, d.h, d.l, d.c);
      o.dayGreen = g[n - 1];
      var dates = d.t.map(function (t) { return new Date(t * 1000).toISOString().slice(0, 10); });
      var w = botWeeklyHa(dates, d.o, d.h, d.l, d.c, true);
      o.weekGreen = w.green[w.green.length - 1];
    }
    coins.push(o);
  });
  if (!coins.length) return {ok: false, msg: "코인 시세를 불러오지 못했어요"};
  var out = {ok: true, coins: coins, fx: fx, updated: Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm:ss")};
  try { cache.put("coin_v1", JSON.stringify(out), 45); } catch (e) {}
  return out;
}

// ---------- 🔎 알트코인 검색 (업비트·빗썸 원화 마켓) + 코인 가치 지표 ----------
function _jsonOr(resp, dflt) { try { return resp.getResponseCode() === 200 ? JSON.parse(resp.getContentText()) : dflt; } catch (e) { return dflt; } }

// 업비트·빗썸에 상장된 원화 마켓 목록 (앱에서 검색용) — 6시간 캐시
function getCoinMarkets(token) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var cache = CacheService.getScriptCache(), hit = cache.get("coin_mk1");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var resps;
  try {
    resps = UrlFetchApp.fetchAll([
      {url: "https://api.upbit.com/v1/market/all?isDetails=false", muteHttpExceptions: true, headers: {accept: "application/json"}},
      {url: "https://api.bithumb.com/v1/market/all?isDetails=false", muteHttpExceptions: true, headers: {accept: "application/json"}}
    ]);
  } catch (e) { return {ok: false, msg: "코인 목록을 불러오지 못했어요"}; }
  var map = {};
  [["U", _jsonOr(resps[0], [])], ["B", _jsonOr(resps[1], [])]].forEach(function (p) {
    (p[1] || []).forEach(function (m) {
      var code = String(m.market || "");
      if (code.indexOf("KRW-") !== 0) return;
      var s = code.slice(4);
      if (!map[s]) map[s] = [s, String(m.korean_name || s), String(m.english_name || ""), p[0]];
      else if (map[s][3].indexOf(p[0]) < 0) map[s][3] += p[0];
    });
  });
  var list = Object.keys(map).sort().map(function (k) { return map[k]; });   // [심볼, 한글이름, 영어이름, 거래소(U/B/UB)]
  if (!list.length) return {ok: false, msg: "코인 목록을 불러오지 못했어요 (거래소 응답 없음)"};
  var out = {ok: true, list: list};
  try { cache.put("coin_mk1", JSON.stringify(out), 21600); } catch (e) {}
  return out;
}

// 체인·프로토콜의 최근 30일 수수료 (DefiLlama) — "코인판 PER" 계산용. {이름소문자: 30일 수수료($)}
function _llamaFees() {
  var cache = CacheService.getScriptCache(), hit = cache.get("llama_f1");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var m = {};
  try {
    var r = UrlFetchApp.fetch("https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyFees", {muteHttpExceptions: true});
    var j = _jsonOr(r, null);
    ((j && j.protocols) || []).forEach(function (p) {
      var v = Number(p.total30d);
      if (!p.name || !(v > 0)) return;
      var k = String(p.name).toLowerCase();
      if (p.category === "Chain" || m[k] == null) m[k] = Math.round(v);     // 같은 이름이면 체인 우선
    });
    var keys = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).slice(0, 600), small = {};
    keys.forEach(function (k) { small[k] = m[k]; });
    m = small;
    cache.put("llama_f1", JSON.stringify(m), 21600);
  } catch (e) {}
  return m;
}
var COIN_FEE_ALIAS = {BNB: "bsc", TRX: "tron", AVAX: "avalanche", POL: "polygon", MATIC: "polygon", TON: "ton", HYPE: "hyperliquid", ARB: "arbitrum", OP: "op mainnet", SUI: "sui", APT: "aptos", NEAR: "near", ADA: "cardano", DOT: "polkadot", ATOM: "cosmos hub", BCH: "bitcoin cash", LTC: "litecoin", DOGE: "dogecoin"};

function getCoinDetail(token, sym) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  sym = String(sym || "").trim().toUpperCase().replace(/^KRW-/, "");
  if (!/^[A-Z0-9]{1,15}$/.test(sym)) return {ok: false, msg: "코인 심볼을 확인하세요"};
  var cache = CacheService.getScriptCache(), ck = "coin_d1_" + sym, hit = cache.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var mk = "KRW-" + sym, H = {accept: "application/json"}, resps;
  try {
    resps = UrlFetchApp.fetchAll([
      {url: "https://api.upbit.com/v1/ticker?markets=" + mk, muteHttpExceptions: true, headers: H},
      {url: "https://api.upbit.com/v1/candles/days?market=" + mk + "&count=200", muteHttpExceptions: true, headers: H},
      {url: "https://api.bithumb.com/v1/ticker?markets=" + mk, muteHttpExceptions: true, headers: H},
      {url: "https://api.bithumb.com/v1/candles/days?market=" + mk + "&count=200", muteHttpExceptions: true, headers: H},
      {url: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=krw&symbols=" + sym.toLowerCase(), muteHttpExceptions: true, headers: H}
    ]);
  } catch (e) { return {ok: false, msg: "코인 시세를 불러오지 못했어요"}; }
  var ut = _jsonOr(resps[0], null), bt = _jsonOr(resps[2], null);
  ut = (ut && ut.length && ut[0].trade_price) ? ut[0] : null;
  bt = (bt && bt.length && bt[0].trade_price) ? bt[0] : null;
  var tk = ut || bt;
  if (!tk) return {ok: false, msg: sym + " 는 업비트·빗썸 원화 마켓에서 못 찾았어요"};
  var cd = _jsonOr(resps[ut ? 1 : 3], []);
  if (!cd || !cd.length) cd = [];
  cd = cd.slice().reverse();                                           // 오래된 → 최근
  var o = [], h = [], l = [], c = [], dates = [];
  cd.forEach(function (x) {
    if (x.trade_price == null) return;
    o.push(Number(x.opening_price)); h.push(Number(x.high_price)); l.push(Number(x.low_price)); c.push(Number(x.trade_price));
    dates.push(String(x.candle_date_time_utc || "").slice(0, 10));
  });
  var px = Number(tk.trade_price), n = c.length;
  var out = {ok: true, sym: sym, ex: ut ? "업비트" : "빗썸", krw: px,
             d1: Number(tk.signed_change_rate) * 100, vol24: Number(tk.acc_trade_price_24h) || null,
             hi52: Number(tk.highest_52_week_price) || null, lo52: Number(tk.lowest_52_week_price) || null,
             other: (ut && bt) ? {ex: "빗썸", krw: Number(bt.trade_price)} : null,
             spark: c.slice(-60), vals: [],
             updated: Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm:ss")};
  var back = function (d) { return n - 1 - d >= 0 ? (px / c[n - 1 - d] - 1) * 100 : null; };
  out.d7 = back(7); out.d30 = back(30);
  if (n >= 20 && typeof botHaGreen === "function") {
    var g = botHaGreen(o, h, l, c); out.dayGreen = g[n - 1];
    var w = botWeeklyHa(dates, o, h, l, c, true); if (w.green.length > 3) out.weekGreen = w.green[w.green.length - 1];
  }
  var tag = function (lv) { return lv > 0 ? "▲ 좋음" : lv < 0 ? "❗ 주의" : "● 중립"; };
  var V = function (name, val, lv, tip) { out.vals.push({name: name, val: val, tag: lv == null ? "" : tag(lv), tip: tip}); };

  // 1) 추세 배수: 현재가 ÷ 200일 평균 (주식의 '200일선 대비'와 같은 개념)
  if (n >= 200) {
    var s = 0; for (var i = n - 200; i < n; i++) s += c[i];
    var mm = px / (s / 200);
    V("추세 배수 (현재가 ÷ 200일 평균)", mm.toFixed(2) + "배", mm < 0.8 ? 1 : mm > 2.4 ? -1 : 0,
      "1배 = 최근 200일 평균 가격. 0.8배 아래면 역사적으로 싼 구간, 2.4배 위면 과열 구간으로 봐요 (비트코인 기준 경험칙).");
  }
  // 2~5) 시가총액·유통량 (CoinGecko)
  var cg = _jsonOr(resps[4], []), g0 = null;
  (cg || []).forEach(function (x) { if (x && x.market_cap > 0 && (!g0 || x.market_cap > g0.market_cap)) g0 = x; });
  if (g0) {
    out.name = g0.name; out.rank = g0.market_cap_rank || null; out.mcap = g0.market_cap;
    if (g0.current_price > 0) out.kimchi = (px / g0.current_price - 1) * 100;
    var full = Number(g0.max_supply) || Number(g0.total_supply) || 0, circ = Number(g0.circulating_supply) || 0;
    if (full > 0 && circ > 0) {
      var cr = Math.min(100, circ / full * 100);
      V("유통률 (풀린 물량 ÷ 전체 물량)", cr.toFixed(0) + "%", cr >= 80 ? 1 : cr < 50 ? -1 : 0,
        "아직 안 풀린 물량이 많으면(유통률 낮음) 앞으로 시장에 풀리면서 가격을 누를 수 있어요. 주식의 '증자·보호예수 해제'와 비슷해요.");
    }
    if (g0.total_volume > 0) {
      var tr = g0.total_volume / g0.market_cap * 100;
      V("회전율 (하루 거래대금 ÷ 시가총액)", tr.toFixed(1) + "%", tr > 50 ? -1 : tr < 0.5 ? -1 : 0,
        "너무 낮으면 팔고 싶을 때 못 파는 코인, 너무 높으면(50%↑) 단타가 몰린 과열 상태일 수 있어요.");
    }
    if (g0.ath_change_percentage != null) V("역대 최고가 대비", Number(g0.ath_change_percentage).toFixed(0) + "%", null,
      "최고가에서 얼마나 내려와 있는지예요. 많이 빠졌다고 싼 건 아니에요. 다시 못 올라가는 코인도 많아요.");
    // "코인판 PER": 시가총액 ÷ 1년 수수료(네트워크가 실제로 버는 돈)
    var fees = _llamaFees(), fk = COIN_FEE_ALIAS[sym] || String(g0.name || "").toLowerCase(), f30 = fees[fk];
    if (f30 > 0) {
      var fxUsd = null;
      try { var fr = _mkParse(UrlFetchApp.fetch("https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?range=5d&interval=1d", {muteHttpExceptions: true})); fxUsd = fr ? (fr.price || fr.c[fr.c.length - 1]) : null; } catch (e) {}
      if (fxUsd) {
        var pf = (g0.market_cap / fxUsd) / (f30 * 12);
        V("코인판 PER (시가총액 ÷ 1년 수수료)", pf >= 1000 ? "1000배 이상" : pf.toFixed(0) + "배", pf < 30 ? 1 : pf > 300 ? -1 : 0,
          "사람들이 이 네트워크를 쓰면서 내는 수수료가 '매출'이에요. 배수가 낮을수록 버는 돈에 비해 싸요. 주식 PER처럼 같은 종류끼리 비교하세요.");
      }
    }
  }
  try { cache.put(ck, JSON.stringify(out), 30); } catch (e) {}
  return out;
}