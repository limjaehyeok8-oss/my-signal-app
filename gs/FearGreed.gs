// ==========================================================
// FearGreed.gs - 공포탐욕지수 (주식: CNN / 코인: alternative.me)
// ==========================================================
var CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fearGreedData() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("fear_greed_v2");
  if (cached) return JSON.parse(cached);

  var out = {ok: true, stock: null, crypto: null, errors: []};
  try { out.stock = fetchCnnFearGreed(); } catch (e) { out.errors.push("주식: " + e.message); }
  try { out.crypto = fetchCryptoFearGreed(); } catch (e) { out.errors.push("코인: " + e.message); }
  if (!out.stock && !out.crypto) return {ok: false, msg: out.errors.join(" / ")};

  // 주식이 실패한 결과는 오래 저장하지 않음 (5분 뒤 다시 시도)
  cache.put("fear_greed_v2", JSON.stringify(out), out.stock ? 1800 : 300);
  return out;
}

function round1(n) {
  return (n == null || isNaN(Number(n))) ? null : Math.round(Number(n) * 10) / 10;
}

// CNN은 브라우저처럼 보이는 요청만 받아줘서, 주소와 헤더를 바꿔 가며 시도합니다.
function fetchCnnFearGreed() {
  var base = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
  var start = Utilities.formatDate(new Date(Date.now() - 200 * 86400000), "UTC", "yyyy-MM-dd");
  var urls = [base + "/" + start, base];
  var headerSets = [
    {"User-Agent": CHROME_UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
     "Origin": "https://edition.cnn.com", "Referer": "https://edition.cnn.com/"},
    {"User-Agent": CHROME_UA, "Accept": "application/json", "Referer": "https://edition.cnn.com/markets/fear-and-greed"}
  ];

  var tried = [], data = null;
  for (var u = 0; u < urls.length && !data; u++) {
    for (var h = 0; h < headerSets.length && !data; h++) {
      try {
        var res = UrlFetchApp.fetch(urls[u], {headers: headerSets[h], muteHttpExceptions: true});
        var code = res.getResponseCode();
        if (code === 200) data = JSON.parse(res.getContentText());
        else tried.push(code);
      } catch (e) {
        tried.push("오류");
      }
    }
  }
  if (!data) throw new Error("CNN 접속 실패 (응답 " + tried.join(", ") + ")");

  var fg = data.fear_and_greed;
  if (!fg || fg.score == null) throw new Error("CNN 데이터 형식이 달라요");

  var hist = ((data.fear_and_greed_historical || {}).data || []).slice(-120)
    .map(function (p) { return {t: p.x, v: round1(p.y)}; });

  var defs = [
    ["market_momentum_sp500", "시장 모멘텀", "S&P 500 vs 125일 이동평균"],
    ["stock_price_strength", "주가 강도", "52주 신고가 vs 신저가 종목 수"],
    ["stock_price_breadth", "주가 폭", "상승 vs 하락 종목 거래량"],
    ["put_call_options", "풋/콜 옵션", "풋옵션 대비 콜옵션 비율"],
    ["market_volatility_vix", "변동성 (VIX)", "VIX vs 50일 이동평균"],
    ["junk_bond_demand", "정크본드 수요", "정크본드와 국채의 금리 차이"],
    ["safe_haven_demand", "안전자산 수요", "주식 vs 국채 수익률 차이"]
  ];
  var indicators = [];
  defs.forEach(function (x) {
    var item = data[x[0]];
    if (item && item.score != null) indicators.push({name: x[1], desc: x[2], score: round1(item.score)});
  });

  return {
    score: round1(fg.score),
    asOf: fg.timestamp,
    prev: {day: round1(fg.previous_close), week: round1(fg.previous_1_week),
           month: round1(fg.previous_1_month), year: round1(fg.previous_1_year)},
    history: hist,
    indicators: indicators
  };
}

function fetchCryptoFearGreed() {
  var res = UrlFetchApp.fetch("https://api.alternative.me/fng/?limit=120&format=json", {muteHttpExceptions: true});
  if (res.getResponseCode() !== 200) throw new Error("응답 코드 " + res.getResponseCode());
  var list = JSON.parse(res.getContentText()).data; // 최신순
  if (!list || !list.length) throw new Error("데이터가 비어 있어요");

  function pick(i) { return list[i] ? Number(list[i].value) : null; }
  var history = list.slice().reverse().map(function (p) {
    return {t: Number(p.timestamp) * 1000, v: Number(p.value)};
  });
  return {
    score: pick(0),
    asOf: new Date(Number(list[0].timestamp) * 1000).toISOString(),
    prev: {day: pick(1), week: pick(7), month: pick(30), year: null},
    history: history,
    indicators: null
  };
}

// 편집기에서 바로 테스트: 로그에 점수가 나오면 성공
function testFearGreed() {
  CacheService.getScriptCache().remove("fear_greed_v2");
  var r = fearGreedData();
  if (!r.ok) return Logger.log("실패: " + r.msg);
  Logger.log("주식(CNN): " + (r.stock ? r.stock.score + " / 지표 " + r.stock.indicators.length + "개" : "실패"));
  Logger.log("코인: " + (r.crypto ? r.crypto.score : "실패"));
  if (r.errors.length) Logger.log("오류: " + r.errors.join(" / "));
}