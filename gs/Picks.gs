// ==========================================================
// Picks.gs — "오늘 신호 뜬 종목" (후보 종목들을 매일 훑어서 신호가 막 뜬 것만 골라줌)
//  - 매일 아침 자동 실행(setupPicksTrigger 한 번 실행) → "picks" 시트에 결과 저장
//  - 앱은 저장된 결과만 읽어가요 (getPicks)
//  - 최근 3거래일 안에 뜬 신호를 모아요
//  - 점수(참고용): ☘️ 저점매수 강 +3 / 약 +1, 일반 매수 신호 +2, 주봉 양봉 +1,
//                  거래량 급증+상승 +1, 횡보장 -2, 주봉 음봉 -1
// 후보 종목은 아래 PICK_UNIVERSE 에서 추가/삭제하세요. (등록된 사람들의 보유 종목도 함께 훑어요)
// ==========================================================
var PICK_GROUPS = {
  "⚡ 레버리지·인버스": ["SOXL","SOXS","TQQQ","SQQQ","UPRO","SPXL","SPXS","TECL","TECS","FNGU","FNGD","NVDL","TSLL","CONL","MSTU","MSTX","BITX","LABU","TNA","TZA","FAS","FAZ","UDOW","YINN","YANG","AMDL","GGLL","AAPU","MSFU","AMZU","ETHU","UVXY","SVXY"],
  "📊 지수·배당 ETF": ["SPY","QQQ","DIA","IWM","VTI","VOO","VUG","VTV","SCHD","JEPI","JEPQ","QYLD","MTUM","QUAL","SPLG","EEM","EFA","KWEB","FXI"],
  "🧩 섹터·테마 ETF": ["SOXX","SMH","XLK","XLF","XLE","XLV","XLY","XLI","XLP","XLU","XLB","XLRE","XLC","ARKK","ARKG","ARKW","XBI","IBB","TAN","ICLN","URA","LIT","COPX","XOP","OIH","KRE","XHB","ITB","JETS","HACK","CIBR","BOTZ","ROBO","SKYY","CLOU","DRIV","IGV","SOXQ","PSI","VNQ"],
  "🪙 금·채권·원자재": ["GLD","SLV","TLT","IEF","HYG","USO","UNG","GDX","GDXJ","SIL"],
  "₿ 크립토 관련": ["BITO","IBIT","FBTC","ETHA","COIN","MSTR","HOOD"],
  "🚀 성장주(대형 기술)": ["AAPL","MSFT","GOOGL","GOOG","AMZN","META","TSLA","NFLX","ORCL","CRM","ADBE","NOW","INTU","UBER","ABNB","BKNG","DASH","SHOP","SPOT","TTD","APP","AXON","RBLX","MELI","SE"],
  "🔌 반도체": ["NVDA","AVGO","AMD","INTC","QCOM","MU","TSM","ASML","ARM","TXN","AMAT","LRCX","KLAC","ADI","MRVL","NXPI","ON","MCHP","SNPS","CDNS","SMCI","WDC","STX","SNDK","MPWR","TER","SWKS","QRVO","GFS","COHR","LITE","CIEN","ANET"],
  "🤖 AI·소프트웨어·신기술": ["PANW","CRWD","FTNT","ZS","NET","DDOG","MDB","SNOW","PLTR","TEAM","WDAY","ADSK","DELL","HPQ","HPE","IBM","CSCO","ACN","SQ","XYZ","PYPL","LYFT","EXPE","U","DOCU","ZM","OKTA","TWLO","PATH","AI","SOUN","BBAI","IONQ","RGTI","QBTS","QUBT","RKLB","ASTS","LUNR","JOBY","ACHR","TEM"],
  "🏦 금융": ["JPM","BAC","WFC","C","GS","MS","SCHW","BLK","AXP","V","MA","COF","BRK-B","SOFI","AFRM","UPST","NU","LC","IBKR","SPGI","MCO","CME","ICE","TFC","USB","PNC"],
  "🛡️ 경기방어주(필수소비·헬스·통신)": ["LLY","UNH","JNJ","PFE","MRK","ABBV","AMGN","GILD","BMY","TMO","DHR","ISRG","MDT","SYK","BSX","VRTX","REGN","MRNA","NVO","CVS","HIMS","CRSP","BEAM","NTLA","COST","WMT","KO","PEP","PG","PM","MO","T","VZ","TMUS","CMCSA","DIS","MCD"],
  "🔥 경기민감주(소비·산업·여행)": ["HD","LOW","TGT","NKE","LULU","SBUX","CMG","BA","CAT","DE","GE","HON","LMT","RTX","NOC","GD","UPS","FDX","UNP","CSX","F","GM","RIVN","LCID","NIO","XPEV","LI","BYD","BABA","PDD","JD","BIDU","CVNA","CELH","ELF","ONON","DECK","CROX","RCL","CCL","NCLH","DAL","UAL","AAL","LUV"],
  "🛢️ 에너지·소재·전력": ["XOM","CVX","COP","OXY","SLB","HAL","EOG","MPC","VLO","FCX","NEM","ALB","MP","CCJ","UEC","LEU","OKLO","SMR","NNE","VST","CEG","TLN","NRG","ENPH","FSLR","SEDG","RUN","PLUG","BE","NEE","DUK","SO"],
  "🧬 중소형·테마주": ["AXTI","IREN","PL","CIFR","WULF","CORZ","APLD","MARA","RIOT","CLSK","HUT","BTBT","NBIS","CRWV","VRT","ALAB","CRDO","RMBS","AAOI","POET","LASR","NVTS","WOLF","INDI","ACLS","ONTO","AEHR","CAMT","ICHR","FORM","SPCE","RDW","BKSY","SATS","KTOS","AVAV","RCAT","ONDS","QS","EOSE","ENVX","FLNC","UAMY","USAR","CRML","RDDT","DUOL","DAVE","MQ","LMND","OPEN","TMDX","SERV","PRCH","AEVA","OUST","LAZR","MVIS","BTDR","SOUN","VERI","GRRR","SMMT","RXRX","TEM","ABCL","CDNA","NTRA","TWST","PACB","ILMN","BE","BLDP","ARRY","SHLS","NXT","STEM","GEV","OKLO"]
};
var PICK_UNIVERSE = [], PICK_GROUP_OF = {};
Object.keys(PICK_GROUPS).forEach(function (g) {
  PICK_GROUPS[g].forEach(function (s) { if (!PICK_GROUP_OF[s]) { PICK_GROUP_OF[s] = g; PICK_UNIVERSE.push(s); } });
});
var PICKS_SHEET = "picks";

function getPicksSheet() {
  var ss = getSheet().getParent();
  var sh = ss.getSheetByName(PICKS_SHEET);
  if (!sh) { sh = ss.insertSheet(PICKS_SHEET); sh.getRange(1, 1, 1, 2).setValues([["updated", "json"]]); }
  return sh;
}

// 이번 하락장(1년 고점 이후)에서 ☘️ 저점매수가 몇 번째 떴는지 센다. 10거래일 안에 붙어서 뜬 건 한 번으로 묶는다.
function cloverCycle(d, haD) {
  var n = d.closes.length, from = Math.max(0, n - 250), peak = from;
  for (var i = from; i < n; i++) if (d.closes[i] > d.closes[peak]) peak = i;
  var dd = (1 - d.closes[n - 1] / d.closes[peak]) * 100;            // 고점 대비 하락률(%)
  var len = n - peak;
  if (len < 5) return {n: 0, dd: dd, lastAge: 999};
  var mk = getCloverMarkersInView(d, haD, peak, len), eps = [], lastIdx = -99;
  for (var j = 0; j < len; j++) {
    if (!mk[j]) continue;
    if (j - lastIdx >= 10 || !eps.length) eps.push(j);               // 새 묶음의 시작
    lastIdx = j;
  }
  var lastEp = eps.length ? eps[eps.length - 1] : -1;
  // lastIdx 는 마지막 마커 위치 (묶음 끝) — 며칠 전인지는 그걸로 계산
  return {n: eps.length, dd: dd, lastAge: eps.length ? (len - 1 - lastIdx) : 999};
}

// 한 종목 분석 → 점수/이유 (신호가 없으면 null)
function pickOne(symbol, d, w) {
  if (!d || d.closes.length < 120 || !w || w.closes.length < 20) return null;
  var len = d.closes.length;
  var price = d.closes[len - 1];
  if (price < 3) return null;                                   // 초저가주 제외
  var haD = calculateHeikinAshi_GAS(d), haW = calculateHeikinAshi_GAS(w);

  var st = getSignalState(d, haD);
  var buyToday = !!(st && st.type === "buy" && st.days <= 2);
  var ctx = getSignalContext(d, w, haD, haW, symbol);

  // 오늘 저점매수(클로버) 여부: Signal.gs 와 같은 기준
  var cloverToday = false, cloverAge = 0;
  try {
    var cl = getCloverMarkersInView(d, haD, len - 3, 3);      // 오늘 포함 최근 3거래일
    for (var ci = 2; ci >= 0; ci--) { if (cl[ci]) { cloverToday = true; cloverAge = 2 - ci; break; } }
  } catch (e) { cloverToday = false; }
  var cc = null;
  try { cc = cloverCycle(d, haD); } catch (e) { cc = null; }
  // 하락장(고점 대비 15%↓)에서 ☘️가 2번 이상 떴고, 마지막이 10거래일 안이면 후보
  var cloverRepeat = !!(cc && cc.dd >= 15 && cc.n >= 2 && cc.lastAge <= 10);
  if (!buyToday && !cloverToday && !cloverRepeat) return null;

  var score = 0, why = [], tag = [];
  if (cloverRepeat) {
    var cAge = cc.lastAge === 0 ? "오늘" : cc.lastAge + "일 전";
    if (cc.n >= 3) {
      score += 3; tag.push("☘️ " + cc.n + "번째 저점매수 · 장기 저점 후보");
      why.push("고점 대비 " + cc.dd.toFixed(0) + "% 내려온 하락장에서 ☘️가 " + cc.n + "번째 (마지막 " + cAge + ") — 보통 3번째쯤이 큰 저점이었어요");
    } else {
      score += 1; tag.push("☘️ " + cc.n + "번째 저점매수");
      why.push("고점 대비 " + cc.dd.toFixed(0) + "% 내려온 하락장에서 ☘️가 " + cc.n + "번째 (마지막 " + cAge + ") — 한 번 더 나올 수도 있어요");
    }
  }
  if (cloverToday) {
    var cAgeTxt = cloverAge === 0 ? "오늘" : cloverAge + "일 전";
    if (ctx.clover.strong) { score += 3; tag.push("☘️ 저점매수(강) " + cAgeTxt); why.push("많이 떨어진 뒤 반등 시작, 확인 조건을 모두 통과"); }
    else { score += 1; tag.push("☘️ 저점매수(약) " + cAgeTxt); why.push("반등 시작했지만 주의: " + ctx.clover.reasons.join(", ")); }
  }
  if (buyToday) {
    score += 2; tag.push("🟢 매수 신호 " + (st.days === 0 ? "오늘" : st.days + "일 전"));
    why.push(st.days === 0 ? "오늘 일반 매수 신호가 떴어요" : st.days + "일 전에 일반 매수 신호가 떴어요");
  }

  var hw = haW.closes.length - 1;
  var weeklyGreen = haW.closes[hw] > haW.opens[hw];
  if (weeklyGreen) { score += 1; why.push("주봉도 양봉(큰 흐름 상승)"); } else { score -= 1; why.push("주봉은 아직 음봉"); }

  // 거래량 급증 + 상승
  var vs = d.volumes.slice(len - 21, len - 1), avgV = 0;
  vs.forEach(function (v) { avgV += v; });
  avgV = vs.length ? avgV / vs.length : 0;
  var volRatio = avgV > 0 ? d.volumes[len - 1] / avgV : 0;
  var up = d.closes[len - 1] > d.closes[len - 2];
  if (volRatio >= 2 && up) { score += 1; why.push("거래량 평소의 " + volRatio.toFixed(1) + "배 + 상승"); }

  if (ctx.sideways) { score -= 2; why.push("⚠️ 횡보장이라 신호가 자주 틀려요"); }

  var ch = (price / d.closes[len - 2] - 1) * 100;
  // 손익비: (가까운 목표 = 최근 60거래일 고점까지 남은 폭) ÷ (손절 폭 = 최근 10거래일 최저가까지)
  // 손절 폭은 하루 평균 변동폭보다 작게 잡지 않고, 종목 성격별 한도(8·12·20%)를 넘기지 않아요.
  var hi60 = 0, lo10 = price;
  for (var hi = Math.max(0, len - 60); hi < len; hi++) { if (d.highs[hi] > hi60) hi60 = d.highs[hi]; }
  for (var lo = Math.max(0, len - 10); lo < len; lo++) { if (d.lows[lo] < lo10) lo10 = d.lows[lo]; }
  var upPct = hi60 > price ? (hi60 / price - 1) * 100 : 0;
  var spPct = Math.min(Math.max((1 - lo10 / price) * 100, ctx.atrPct || 1), ctx.cls.stopPct || 12);
  spPct = Number(spPct.toFixed(1));
  var rr = spPct > 0 ? Number((upPct / spPct).toFixed(1)) : 0;
  return {s: symbol, up: Math.round(upPct), sp: spPct, rr: rr, p: Number(price.toFixed(2)), ch: Number(ch.toFixed(1)), sc: score, tag: tag, why: why, cls: ctx.cls.name, g: PICK_GROUP_OF[symbol] || "🧑 내 보유·기타",
          lt: cloverRepeat ? 1 : 0, cn: cc ? cc.n : 0, dd: cc ? Math.round(cc.dd) : 0};
}

// 후보 + 등록된 사람들의 보유 종목 전체
function pickUniverse() {
  var set = {}, list = [];
  PICK_UNIVERSE.forEach(function (s) { if (!set[s]) { set[s] = 1; list.push(s); } });
  try {
    var hs = getHoldingsSheet(), last = hs.getLastRow();
    if (last >= 2) hs.getRange(2, 2, last - 1, 1).getValues().forEach(function (r) {
      var s = String(r[0] || "").trim().toUpperCase();
      if (s && /^[A-Z0-9.\-]{1,10}$/.test(s) && !set[s]) { set[s] = 1; list.push(s); }
    });
  } catch (e) {}
  return list;
}

var PICK_PER_GROUP = 15;  // 분야마다 저장해두는 개수 (화면에서는 필터마다 분야별 5개씩 보여줘요)
function _topPerGroup(items, n) {
  var cnt = {}, out = [];
  items.forEach(function (x) {                                   // items 는 이미 점수 높은 순
    var g = x.g || "";
    cnt[g] = (cnt[g] || 0) + 1;
    if (cnt[g] <= n) out.push(x);
  });
  return out;
}

// 장기 저점 후보(☘️ 반복)는 따로 모으고, 나머지는 분야별로 자름
function _splitPicks(items) {
  var lt = items.filter(function (x) { return x.lt; });
  var rest = items.filter(function (x) { return !x.lt; });
  lt.sort(function (a, b) { return b.cn - a.cn || b.dd - a.dd; });
  return _topPerGroup(rest, PICK_PER_GROUP).concat(lt.slice(0, 40));
}

// 전체 훑기 (매일 자동 / 수동 실행 가능)
function refreshPicks() {
  var t0 = Date.now();
  var props = PropertiesService.getScriptProperties();
  props.setProperty("PICKS_RUN_AT", String(t0));                // 계산 중 표시
  var universe = pickUniverse();
  var items = [], highs = [], scanned = 0, CH = 25;
  for (var i = 0; i < universe.length; i += CH) {
    if (Date.now() - t0 > 5 * 60 * 1000) break;                 // 6분 제한 전에 멈춤
    var chunk = universe.slice(i, i + CH);
    var reqs = [];
    chunk.forEach(function (s) {
      var base = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s);
      reqs.push({url: base + "?range=1y&interval=1d", muteHttpExceptions: true});
      reqs.push({url: base + "?range=5y&interval=1wk", muteHttpExceptions: true});
    });
    var resps;
    try { resps = UrlFetchApp.fetchAll(reqs); } catch (e) { continue; }
    chunk.forEach(function (s, k) {
      try {
        var a = resps[k * 2], b = resps[k * 2 + 1];
        if (a.getResponseCode() !== 200 || b.getResponseCode() !== 200) return;
        var d = processYahooData(JSON.parse(a.getContentText()));
        var w = processYahooData(JSON.parse(b.getContentText()));
        scanned++;
        try {                                              // 52주 신고가: 1년 최고가를 최근 5거래일 안에 찍은 종목
          var hl = d.highs.length;
          if (hl >= 200 && d.closes[hl - 1] >= 3) {
            var mx = 0, mi = -1;
            for (var q = 0; q < hl; q++) { if (d.highs[q] >= mx) { mx = d.highs[q]; mi = q; } }
            if (hl - 1 - mi <= 4) highs.push({s: s, g: PICK_GROUP_OF[s] || "기타", p: Number(d.closes[hl - 1].toFixed(2)),
              ch: Number(((d.closes[hl - 1] / d.closes[hl - 2] - 1) * 100).toFixed(1)), ago: hl - 1 - mi,
              m1: hl > 22 ? Number(((d.closes[hl - 1] / d.closes[hl - 22] - 1) * 100).toFixed(0)) : null});
          }
        } catch (e) {}
        var r = pickOne(s, d, w);
        if (r && r.sc >= 1) items.push(r);                 // 점수 1점 이상만 보여줌
      } catch (e) { /* 한 종목 실패는 무시 */ }
    });
  }
  items.sort(function (x, y) { return y.sc - x.sc || y.ch - x.ch; });
  var out = {scanned: scanned, total: universe.length, items: _splitPicks(items), highs: highs.slice(0, 150)};
  var sh = getPicksSheet();
  sh.getRange(2, 1, 1, 2).setValues([[Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), JSON.stringify(out)]]);
  props.deleteProperty("PICKS_RUN_AT");
  props.setProperty("PICKS_DONE_AT", String(Date.now()));
  return out;
}

function getPicks(token, force) {
  if (!isRegistered(token)) return {ok: false, msg: "먼저 '알림 받기'로 등록하세요"};
  var sh = getPicksSheet();
  var o = {}, upd = "", lastMs = 0;
  if (sh.getLastRow() >= 2) {
    var v = sh.getRange(2, 1, 1, 2).getValues()[0];
    upd = String(v[0] || "");
    if (v[0] instanceof Date) lastMs = v[0].getTime();
    else if (/^\d{4}-\d\d-\d\d \d\d:\d\d/.test(upd)) lastMs = new Date(upd.slice(0, 10) + "T" + upd.slice(11, 16) + ":00+09:00").getTime();
    try { o = JSON.parse(String(v[1] || "{}")); } catch (e) { o = {}; }
  }
  // 새로고침 버튼(force)이거나 아직 결과가 없으면 뒤에서 다시 계산 (10분 안에 또 누르면 무시)
  var refreshing = false;
  try {
    var props = PropertiesService.getScriptProperties();
    var now = Date.now();
    var done = Number(props.getProperty("PICKS_DONE_AT") || 0);
    var run = Number(props.getProperty("PICKS_RUN_AT") || 0);
    if (run && now - run < 8 * 60 * 1000) refreshing = true;
    else if ((force && now - done > 10 * 60 * 1000) || !upd || (lastMs && now - lastMs > 10 * 3600 * 1000 && now - done > 10 * 3600 * 1000)) {   // 10시간 넘게 오래됐으면 열 때 자동 갱신
      props.setProperty("PICKS_RUN_AT", String(now));
      ScriptApp.newTrigger("refreshPicksOnce").timeBased().after(1000).create();
      refreshing = true;
    }
  } catch (e) { /* 트리거를 못 만들어도 기존 결과는 보여줌 */ }
  return {ok: true, updated: upd, scanned: o.scanned || 0, total: o.total || 0, items: o.items || [], highs: o.highs || null, refreshing: refreshing, groups: Object.keys(PICK_GROUPS)};
}

// 한 번짜리 트리거가 부르는 함수: 계산하고 자기 트리거를 지움
function refreshPicksOnce() {
  try { refreshPicks(); }
  finally {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === "refreshPicksOnce") ScriptApp.deleteTrigger(t);
    });
  }
}

// 한 번만 실행: 매일 아침 7시쯤 자동 계산 (미국 장 마감 후)
function setupPicksTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "refreshPicks") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("refreshPicks").timeBased().everyDays(1).atHour(7).create();
}