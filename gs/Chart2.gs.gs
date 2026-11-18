// ==========================================================
// Chart2.gs — 분석 차트 (RSI·스토캐스틱RSI 칸 추가판)
// 기존 buildChartImage 와 같은 차트에 아래쪽 칸 2개를 더하고 세로를 늘림.
// ==========================================================
// ==========================================================
// RSI 다이버전스(가격과 RSI가 반대로 움직임) 두 점을 찾아서 차트용 좌표로 돌려줌
//  상승: 가격 저점은 낮아지는데 RSI 저점은 높아짐 / 하락: 가격 고점은 높아지는데 RSI 고점은 낮아짐
// 반환: {bull:{i1,i2,p1,p2,r1,r2}|null, bear:{...}|null}  (i = 차트 90일 안에서의 위치)
// ==========================================================
function getDivergenceView(data, rsi, viewStartIdx, viewLen) {
  var lows = data.lows, highs = data.highs;
  var len = rsi.length, dLen = lows.length, offset = dLen - len;
  var startI = Math.max(0, len - 150);
  var valleys = [], peaks = [], inLow = false, curV = null, inHigh = false, curP = null;
  for (var i = startI; i < len; i++) {
    var pIdx = i + offset;
    if (pIdx < 0) continue;
    var r = rsi[i];
    if (r < 35) {
      if (!inLow) { inLow = true; curV = {idx: pIdx, rsi: r, price: lows[pIdx]}; }
      else if (r < curV.rsi) curV = {idx: pIdx, rsi: r, price: lows[pIdx]};
    } else if (inLow && curV) { valleys.push(curV); inLow = false; }
    if (r > 65) {
      if (!inHigh) { inHigh = true; curP = {idx: pIdx, rsi: r, price: highs[pIdx]}; }
      else if (r > curP.rsi) curP = {idx: pIdx, rsi: r, price: highs[pIdx]};
    } else if (inHigh && curP) { peaks.push(curP); inHigh = false; }
  }
  function pack(a, b) {
    var i1 = a.idx - viewStartIdx, i2 = b.idx - viewStartIdx;
    if (i2 < 0 || i2 >= viewLen) return null;               // 최근 90일 안에 끝난 것만 표시
    var p1 = a.price, r1 = a.rsi;
    if (i1 < 0) {                                           // 시작점이 화면 왼쪽 밖이면 화면 끝까지만 잘라서 그림
      var t = (0 - i1) / (i2 - i1);
      p1 = a.price + (b.price - a.price) * t;
      r1 = a.rsi + (b.rsi - a.rsi) * t;
      i1 = 0;
    }
    return {i1: i1, i2: i2, p1: p1, p2: b.price, r1: r1, r2: b.rsi};
  }
  var bull = null, bear = null;
  if (valleys.length >= 2) {
    var v1 = valleys[valleys.length - 2], v2 = valleys[valleys.length - 1];
    if (v2.price < v1.price && v2.rsi > v1.rsi) bull = pack(v1, v2);
  }
  if (peaks.length >= 2) {
    var q1 = peaks[peaks.length - 2], q2 = peaks[peaks.length - 1];
    if (q2.price > q1.price && q2.rsi < q1.rsi) bear = pack(q1, q2);
  }
  return {bull: bull, bear: bear};
}

function buildChartImage2(ticker, dates, opens, highs, lows, closes, volumes, ma20, buyMarkers, sellMarkers,
    lResArr, sResArr, sSupArr, lSupArr, lResG, sResG, sSupG, lSupG, highpointSell, volSurge,
    longStopPrice, entryZone1, entryZone2, macdValues, cloverMarkers, rsiValues, stochValues, divView) {

  var candle = [], ma = [], buy = [], sell = [], hp = [], clover = [], surgeUp = [], surgeDown = [];
  var vol = [], volColors = [], lRes = [], sRes = [], sSup = [], lSup = [];
  var macdBar = [], macdLine = [], macdColors = [];
  var rangeMax = Math.max.apply(null, highs), rangeMin = Math.min.apply(null, lows);
  var offset = (rangeMax - rangeMin) * 0.03 || closes[0] * 0.01;

  for (var i = 0; i < dates.length; i++) {
    candle.push({x: dates[i], o: opens[i], h: highs[i], l: lows[i], c: closes[i]});
    ma.push({x: dates[i], y: ma20[i]});
    vol.push({x: dates[i], y: volumes[i]});
    volColors.push(closes[i] >= opens[i] ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)');
    if (buyMarkers[i] !== null) buy.push({x: dates[i], y: buyMarkers[i]});
    if (sellMarkers[i] !== null) sell.push({x: dates[i], y: sellMarkers[i]});
    if (highpointSell[i]) hp.push({x: dates[i], y: highs[i] + offset * 2});
    if (cloverMarkers[i]) clover.push({x: dates[i], y: lows[i] - offset});
    if (volSurge[i] === 'up') surgeUp.push({x: dates[i], y: volumes[i] * 1.15});
    else if (volSurge[i] === 'down') surgeDown.push({x: dates[i], y: volumes[i] * 1.15});
    if (lResArr) lRes.push({x: dates[i], y: lResArr[i]});
    if (sResArr) sRes.push({x: dates[i], y: sResArr[i]});
    if (sSupArr) sSup.push({x: dates[i], y: sSupArr[i]});
    if (lSupArr) lSup.push({x: dates[i], y: lSupArr[i]});
    var mv = macdValues[i] !== undefined ? macdValues[i] : 0;
    macdBar.push({x: dates[i], y: mv});
    macdLine.push({x: dates[i], y: mv});
    macdColors.push(mv >= 0 ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)');
  }

  var priceMin = Math.min.apply(null, lows), priceMax = Math.max.apply(null, highs);
  var hasDiv = !!(divView && (divView.bull || divView.bear));
  var pricePad = (priceMax - priceMin) * (hasDiv ? 0.13 : 0.06);
  var macdAbsMax = Math.max.apply(null, macdBar.map(function (d) { return Math.abs(d.y); })) || 1;
  var maxVol = Math.max.apply(null, volumes);
  var volMax = isFinite(maxVol) && maxVol > 0 ? maxVol * 1.1 : 100;

  var rsiLine = [], stochLine = [], rsi70 = [], rsi30 = [], st80 = [], st20 = [];
  for (var q = 0; q < dates.length; q++) {
    var rv = rsiValues && rsiValues[q] !== undefined ? rsiValues[q] : null;
    var sv = stochValues && stochValues[q] !== undefined ? stochValues[q] : null;
    rsiLine.push({x: dates[q], y: rv});
    stochLine.push({x: dates[q], y: sv});
    rsi70.push({x: dates[q], y: 70}); rsi30.push({x: dates[q], y: 30});
    st80.push({x: dates[q], y: 80}); st20.push({x: dates[q], y: 20});
  }
  var rsiHi = [], rsiLo = [], stHi = [], stLo = [];
  for (var z = 0; z < dates.length; z++) {
    var rz = rsiLine[z].y, sz = stochLine[z].y;
    rsiHi.push({x: dates[z], y: rz == null ? null : Math.max(rz, 70)});
    rsiLo.push({x: dates[z], y: rz == null ? null : Math.min(rz, 30)});
    stHi.push({x: dates[z], y: sz == null ? null : Math.max(sz, 80)});
    stLo.push({x: dates[z], y: sz == null ? null : Math.min(sz, 20)});
  }
  function zone(data, axis, level, above, color) {   // level 선을 기준으로 위(또는 아래)로 벗어난 부분만 색칠
    var f = above ? {target: {value: level}, above: color, below: 'rgba(0,0,0,0)'}
                  : {target: {value: level}, below: color, above: 'rgba(0,0,0,0)'};
    return {type: 'line', label: 'zone', data: data, borderWidth: 0, pointRadius: 0, fill: f, yAxisID: axis};
  }
  // 칸 구분: 각 칸의 윗변에 굵은 선, 한 칸 걸러 하나씩 연한 배경색
  function panelTop(axis, topVal, botVal, tint) {
    var topLine = [], i2;
    for (i2 = 0; i2 < dates.length; i2++) topLine.push({x: dates[i2], y: topVal});
    var out = [{type: 'line', label: 'edge', data: topLine, borderColor: '#3c4256', borderWidth: 1, pointRadius: 0, fill: false, yAxisID: axis, order: -5}];
    if (tint) {
      out.push({type: 'line', label: 'tint', data: topLine, borderWidth: 0, pointRadius: 0, yAxisID: axis, order: 50,
                fill: {target: {value: botVal}, above: tint, below: tint}});
    }
    return out;
  }
  var panelSets = []
    .concat(panelTop('y-macd', macdAbsMax * 1.15, -macdAbsMax * 1.15, null))
    .concat(panelTop('y-rsi', 90, 10, null))
    .concat(panelTop('y-stoch', 100, 0, null))
    .concat(panelTop('y-volume', volMax, 0, null));

  var DIV_COLOR = '#ff4fd8';
  var divSets = [], divTexts = [];
  function addDiv(d, isBull) {
    if (!d) return;
    divSets.push({type: 'line', label: 'divP', data: [{x: dates[d.i1], y: d.p1}, {x: dates[d.i2], y: d.p2}], borderColor: DIV_COLOR, borderWidth: 2, pointRadius: 0, fill: false, yAxisID: 'y', order: -8});
    divSets.push({type: 'line', label: 'divR', data: [{x: dates[d.i1], y: d.r1}, {x: dates[d.i2], y: d.r2}], borderColor: DIV_COLOR, borderWidth: 2, pointRadius: 3, pointBackgroundColor: DIV_COLOR, fill: false, yAxisID: 'y-rsi', order: -8});
    divSets.push({type: 'scatter', label: 'divArrow', data: [{x: dates[d.i2], y: isBull ? d.p2 - offset * 2.2 : d.p2 + offset * 2.2}],
                  backgroundColor: DIV_COLOR, borderColor: '#ffffff', borderWidth: 1.5, pointStyle: 'triangle', rotation: isBull ? 0 : 180, radius: 10, yAxisID: 'y', order: -9});
    divTexts.push(isBull ? "▲ 상승 다이버전스: 가격 저점은 낮아졌는데 RSI 저점은 높아짐 (반등 신호 가능)"
                         : "▼ 하락 다이버전스: 가격 고점은 높아졌는데 RSI 고점은 낮아짐 (꺾임 신호 가능)");
  }
  if (divView) { addDiv(divView.bull, true); addDiv(divView.bear, false); }
  if (divView && !divView.bull && !divView.bear) divTexts.push("RSI 다이버전스: 최근 90일엔 없음");

  var lastR = rsiValues && rsiValues.length ? rsiValues[rsiValues.length - 1] : null;
  var lastS = stochValues && stochValues.length ? stochValues[stochValues.length - 1] : null;
  var subText = "아래쪽 칸 (위→아래): MACD · RSI(9) " + (lastR != null ? Math.round(lastR) : "-") +
                " (점선 30/70) · 스토캐스틱RSI " + (lastS != null ? Math.round(lastS) : "-") + " (점선 20/80) · 거래량";

  var stop = [], z1 = [], z2 = [];
  for (var h = Math.max(0, dates.length - 20); h < dates.length; h++) {
    if (longStopPrice) stop.push({x: dates[h], y: longStopPrice});
    if (entryZone1) z1.push({x: dates[h], y: entryZone1});
    if (entryZone2) z2.push({x: dates[h], y: entryZone2});
  }

  function line(label, data, color, width, dash) {
    return {type: 'line', label: label, data: data, borderColor: color, borderWidth: width, borderDash: dash || [],
            fill: false, pointRadius: 0, yAxisID: 'y'};
  }
  function dot(label, data, bg, style, radius, axis, border) {
    return {type: 'scatter', label: label, data: data, backgroundColor: bg, borderColor: border || bg,
            borderWidth: border ? 2 : 1, pointStyle: style, radius: radius, yAxisID: axis || 'y'};
  }

  var chartConfig = {
    type: 'candlestick',
    data: {
      labels: dates,
      datasets: [
        {type: 'candlestick', label: '주가', data: candle, yAxisID: 'y',
         color: {up: '#26a69a', down: '#ef5350', unchanged: '#787b86'}, barPercentage: 0.35, categoryPercentage: 0.45,
         // 캔들 테두리를 몸통과 같은 색으로 (어두운 테두리 없앰). 색은 chartRemap 이 색약·흰 배경에 맞게 바꿈
         borderColor: {up: '#26a69a', down: '#ef5350', unchanged: '#787b86'}, borderWidth: 1},
        line('20일선', ma, '#f5a623', 1.5),
        line('1차 진입후보', z1, '#00bcd4', 1.8),
        line('2차 진입후보', z2, '#0091ea', 1.8, [4, 3]),
        line('장기손절가', stop, '#d50000', 2, [3, 3]),
        line(lResG ? '장기추세저항' : '장기채널상단', lRes, '#ff5252', 1.3, [6, 4]),
        line(sResG ? '단기추세저항' : '단기채널상단', sRes, '#ffb74d', 1.3, [6, 4]),
        line(sSupG ? '단기추세지지' : '단기채널하단', sSup, '#81c784', 1.3, [6, 4]),
        line(lSupG ? '장기추세지지' : '장기채널하단', lSup, '#26a69a', 1.3, [6, 4]),
        dot('매수 타점', buy, '#00e676', 'triangle', 8),
        dot('매도 타점', sell, '#ff5252', 'rectRot', 8),
        dot('고점매도', hp, '#ab47bc', 'rect', 9, 'y', '#ffffff'),
        dot('저점매수', clover, '#64dd17', 'circle', 8),
        dot('거래량급증(상승)', surgeUp, '#ffd54f', 'triangle', 6, 'y-volume'),
        dot('거래량급증(하락)', surgeDown, '#ffd54f', 'rectRot', 6, 'y-volume'),
        panelSets[0], panelSets[1], panelSets[2], panelSets[3],
        divSets[0] || {type: 'line', data: []}, divSets[1] || {type: 'line', data: []}, divSets[2] || {type: 'line', data: []},
        divSets[3] || {type: 'line', data: []}, divSets[4] || {type: 'line', data: []}, divSets[5] || {type: 'line', data: []},
        zone(rsiHi, 'y-rsi', 70, true, 'rgba(255,82,82,0.22)'),
        zone(rsiLo, 'y-rsi', 30, false, 'rgba(0,230,118,0.22)'),
        zone(stHi, 'y-stoch', 80, true, 'rgba(255,82,82,0.22)'),
        zone(stLo, 'y-stoch', 20, false, 'rgba(0,230,118,0.22)'),
        {type: 'line', label: 'RSI', data: rsiLine, borderColor: '#b388ff', borderWidth: 1.5, fill: false, pointRadius: 0, yAxisID: 'y-rsi'},
        {type: 'line', label: 'RSI70', data: rsi70, borderColor: 'rgba(255,82,82,0.65)', borderWidth: 1, borderDash: [4, 4], fill: false, pointRadius: 0, yAxisID: 'y-rsi'},
        {type: 'line', label: 'RSI30', data: rsi30, borderColor: 'rgba(0,230,118,0.65)', borderWidth: 1, borderDash: [4, 4], fill: false, pointRadius: 0, yAxisID: 'y-rsi'},
        {type: 'line', label: '스토캐스틱RSI', data: stochLine, borderColor: '#4dd0e1', borderWidth: 1.5, fill: false, pointRadius: 0, yAxisID: 'y-stoch'},
        {type: 'line', label: 'ST80', data: st80, borderColor: 'rgba(255,82,82,0.65)', borderWidth: 1, borderDash: [4, 4], fill: false, pointRadius: 0, yAxisID: 'y-stoch'},
        {type: 'line', label: 'ST20', data: st20, borderColor: 'rgba(0,230,118,0.65)', borderWidth: 1, borderDash: [4, 4], fill: false, pointRadius: 0, yAxisID: 'y-stoch'},
        {type: 'bar', label: 'MACD', data: macdBar, backgroundColor: macdColors, yAxisID: 'y-macd', barPercentage: 0.35, categoryPercentage: 0.45},
        {type: 'line', label: 'MACD Line', data: macdLine, borderColor: '#f5a623', borderWidth: 1.2, fill: false, pointRadius: 0, tension: 0.2, yAxisID: 'y-macd'},
        {type: 'bar', label: '거래량', data: vol, backgroundColor: volColors, yAxisID: 'y-volume', barPercentage: 0.35, categoryPercentage: 0.45}
      ]
    },
    options: {
      plugins: {
        legend: {display: false},
        datalabels: {display: false},
        title: {display: true, text: ticker + ' AI 최근 ' + dates.length + '일 타점 차트', color: '#d1d4dc', font: {size: 16}},
        subtitle: {display: divTexts.length > 0, text: divTexts, color: (hasDiv ? '#ff8ae8' : '#787b86'), font: {size: 11}, padding: {bottom: 6}}
      },
      scales: {
        x: {type: 'category', grid: {color: '#1e2336'}, ticks: {color: '#787b86', maxTicksLimit: 12}},
        y: {type: 'linear', position: 'right', stack: 'p', stackWeight: 6, grid: {color: '#2b2b43'}, ticks: {color: '#787b86'},
            min: priceMin - pricePad, max: priceMax + pricePad},
        'y-macd': {type: 'linear', position: 'right', stack: 'p', stackWeight: 1.7, grid: {color: 'rgba(0,0,0,0)'},
                   ticks: {display: false}, min: -macdAbsMax * 1.15, max: macdAbsMax * 1.15,
                   title: {display: true, text: 'MACD', color: '#f5a623', font: {size: 11}}},
        'y-rsi': {type: 'linear', position: 'right', stack: 'p', stackWeight: 2, grid: {color: 'rgba(0,0,0,0)'},
                  ticks: {color: '#8f78c8', font: {size: 10}, stepSize: 20, autoSkip: false}, min: 10, max: 90,
                  title: {display: true, text: 'RSI(9)', color: '#b388ff', font: {size: 11}}},
        'y-stoch': {type: 'linear', position: 'right', stack: 'p', stackWeight: 2, grid: {color: 'rgba(0,0,0,0)'},
                    ticks: {color: '#4aa7b3', font: {size: 10}, stepSize: 20, autoSkip: false}, min: 0, max: 100,
                    title: {display: true, text: '스토캐스틱RSI', color: '#4dd0e1', font: {size: 11}}},
        'y-volume': {type: 'linear', position: 'right', stack: 'p', stackWeight: 1.2, grid: {color: 'rgba(0,0,0,0)'},
                     ticks: {display: false}, min: 0, max: volMax,
                     title: {display: true, text: '거래량', color: '#787b86', font: {size: 11}}}
      }
    }
  };

  var qcReq = function () { return UrlFetchApp.fetch('https://quickchart.io/chart', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({version: '3', chart: ((typeof _CHART_CB !== 'undefined' && _CHART_CB) || (typeof _CHART_WHITE !== 'undefined' && _CHART_WHITE)) ? JSON.parse(chartRemap(JSON.stringify(chartConfig), (typeof _CHART_CB !== 'undefined' && _CHART_CB), (typeof _CHART_WHITE !== 'undefined' && _CHART_WHITE))) : chartConfig, width: 800, height: 820, backgroundColor: (typeof _CHART_WHITE !== 'undefined' && _CHART_WHITE) ? '#ffffff' : '#131722'}),
    muteHttpExceptions: true
  }); };
  var response = null;
  for (var qn = 0; qn < 2; qn++) {                                                // 한 번 실패하면 잠깐 뒤 한 번 더
    try { response = qcReq(); if (response.getResponseCode() === 200) break; } catch (e) { response = null; }
    Utilities.sleep(700);
  }
  if (!response || response.getResponseCode() !== 200) return null;
  return Utilities.base64Encode(response.getBlob().getBytes());
}

// 차트 색 바꾸기. cb=색약 팔레트(상승·매수 노랑 / 하락·매도 파랑), white=흰 배경(글자·격자를 어둡게, 옅은 색은 진하게)
function chartRemap(js, cb, white) {
  var m = [];
  if (cb) {
    var Y = white ? "#d99a00" : "#ffd43b", Yr = white ? "rgba(217,154,0," : "rgba(255,212,59,", B = white ? "#0072b2" : "#4da3ff", Br = white ? "rgba(0,114,178," : "rgba(77,163,255,";
    m.push(["#26a69a", Y], ["rgba(38,166,154,", Yr],                            // 상승 캔들·거래량·MACD 양수 / 장기지지선
           ["#ef5350", B], ["rgba(239,83,80,", Br],                              // 하락 캔들·거래량·MACD 음수
           ["#00e676", Y], ["rgba(0,230,118,", Yr],                              // 매수 타점 / 과매도 영역
           ["#ff5252", B], ["rgba(255,82,82,", Br],                              // 매도 타점 / 과매수 영역 / 장기저항선
           ["#64dd17", "#ff9800"], ["#81c784", white ? "#b38600" : "#ffe58a"],   // 저점매수 / 단기지지선
           ["#d50000", white ? "#000000" : "#ffffff"],                           // 장기손절가 선
           ["#f5a623", white ? "#444b5e" : "#e8ecf2"], ["#ffb74d", white ? "#8a6d00" : "#f0d9a8"]);   // 20일선·MACD 선 / 단기저항선 (노랑·파랑과 안 겹치게)
  }
  if (white) {
    m.push(["#d1d4dc", "#1a1f2e"], ["#787b86", "#5a6070"], ["#1e2336", "#e6e9f0"], ["#2b2b43", "#dfe3ea"], ["#3c4256", "#d0d5de"],
           ["#4dd0e1", "#0097a7"], ["#4aa7b3", "#00838f"], ["#ffd54f", "#e0a800"], ["#ff8ae8", "#c2189e"]);
  }
  for (var i = 0; i < m.length; i++) js = js.split(m[i][0]).join(m[i][1]);
  return js;
}
