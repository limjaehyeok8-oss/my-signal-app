"""예전 신호 규칙 vs 새 신호 규칙 수익률 비교 (최근 5년, 실제 시세).
체결: 신호 다음 날 시가.  비용: 매수·매도 각 0.1%.  끝까지 들고 있으면 마지막 종가로 평가."""
import yfinance as yf, numpy as np, json

TICKERS = ("AAPL MSFT NVDA GOOGL AMZN META TSLA AVGO AMD NFLX JPM V MA XOM CVX JNJ LLY ABBV PG KO PEP COST WMT HD "
           "BAC DIS INTC CSCO ORCL CRM ADBE QCOM MU PLTR COIN UBER BA CAT GE NKE "
           "SPY QQQ IWM SOXX TQQQ SOXL TSLL NVDL").split()
FEE = 0.001

def flags(o, h, l, c):
    n = len(c)
    hc = (o + h + l + c) / 4
    ho = np.empty(n); ho[0] = (o[0] + c[0]) / 2
    for i in range(1, n): ho[i] = (ho[i - 1] + hc[i - 1]) / 2
    g = hc > ho
    ma = np.full(n, np.nan)
    cs = np.cumsum(c)
    ma[19:] = (cs[19:] - np.concatenate(([0], cs[:-20]))) / 20
    return g, ma

def run(o, c, g, ma, new):
    n = len(c); hold = False; pe = px = False; eq = 1.0; ent = 0.0; trades = 0; wins = 0; days = 0
    pend = None
    for k in range(n):
        if pend == "buy": hold = True; ent = o[k] * (1 + FEE); pend = None
        elif pend == "sell":
            r = o[k] * (1 - FEE) / ent; eq *= r; trades += 1; wins += r > 1; hold = False; pend = None
        if hold: days += 1
        if np.isnan(ma[k]):
            continue
        e = g[k] and c[k] > ma[k]; x = (not g[k]) and c[k] < ma[k]
        pg = g[k - 1] if k > 0 else False
        ob = g[k] and not pg and c[k] > ma[k]; os_ = (not g[k]) and pg and c[k] < ma[k]
        nb = e and not pe; ns = x
        bs, ss = {0: (ob, os_), 1: (nb, ns), 2: (ob, ns), 3: (nb, os_)}[int(new)]
        if not hold and bs: pend = "buy"
        elif hold and ss: pend = "sell"
        pe, px = e, x
    if hold: eq *= c[-1] * (1 - FEE) / ent
    return (eq - 1) * 100, trades, (wins / trades * 100 if trades else 0), days / n * 100

NAMES = ["old", "new", "oldBuy+newSell", "newBuy+oldSell"]
res = {k: [] for k in range(4)}; holds = []
for t in TICKERS:
    try:
        d = yf.Ticker(t).history(period="5y", interval="1d", auto_adjust=True).dropna()
        if len(d) < 300: continue
        o, h, l, c = (d[x].to_numpy(dtype=float) for x in ("Open", "High", "Low", "Close"))
        g, ma = flags(o, h, l, c)
        for k in range(4): res[k].append(run(o, c, g, ma, k))
        holds.append((c[-1] / c[19] - 1) * 100)
    except Exception as ex:
        print(t, "ERR", ex)
n = len(holds)
for k in range(4):
    r = np.array([x[0] for x in res[k]]); base = np.array([x[0] for x in res[0]])
    print("RESULT %-16s median %6.1f%% avg %6.1f%% trades %5.1f win %4.1f%% inMarket %4.1f%% betterThanOld %d/%d worst %6.1f%%" % (
        NAMES[k], np.median(r), r.mean(), np.mean([x[1] for x in res[k]]), np.mean([x[2] for x in res[k]]), np.mean([x[3] for x in res[k]]), int((r > base).sum()), n, r.min()))
print("RESULT hold             median %6.1f%% avg %6.1f%%" % (np.median(holds), np.mean(holds)))
