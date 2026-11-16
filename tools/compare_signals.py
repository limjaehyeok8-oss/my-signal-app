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
        if new:
            if not hold and e and not pe: pend = "buy"
            elif hold and x: pend = "sell"
        else:
            pg = g[k - 1] if k > 0 else False
            if not hold and g[k] and not pg and c[k] > ma[k]: pend = "buy"
            elif hold and (not g[k]) and pg and c[k] < ma[k]: pend = "sell"
        pe, px = e, x
    if hold: eq *= c[-1] * (1 - FEE) / ent
    return (eq - 1) * 100, trades, (wins / trades * 100 if trades else 0), days / n * 100

rows = []
for t in TICKERS:
    try:
        d = yf.Ticker(t).history(period="5y", interval="1d", auto_adjust=True).dropna()
        if len(d) < 300: continue
        o, h, l, c = (d[x].to_numpy(dtype=float) for x in ("Open", "High", "Low", "Close"))
        g, ma = flags(o, h, l, c)
        a = run(o, c, g, ma, False); b = run(o, c, g, ma, True)
        bh = (c[-1] / c[19] - 1) * 100
        rows.append((t, a, b, bh, len(d)))
        print(f"{t:6s} old {a[0]:8.1f}% ({a[1]:3d}t win {a[2]:3.0f}% in {a[3]:3.0f}%) | new {b[0]:8.1f}% ({b[1]:3d}t win {b[2]:3.0f}% in {b[3]:3.0f}%) | hold {bh:8.1f}%")
    except Exception as ex:
        print(t, "ERR", ex)

def med(i, j): return float(np.median([r[i][j] for r in rows]))
def avg(i, j): return float(np.mean([r[i][j] for r in rows]))
better = sum(1 for r in rows if r[2][0] > r[1][0])
print("SUMMARY " + json.dumps({"n": len(rows), "new_better": better,
    "old_med": round(med(1, 0), 1), "new_med": round(med(2, 0), 1), "old_avg": round(avg(1, 0), 1), "new_avg": round(avg(2, 0), 1),
    "old_trades": round(avg(1, 1), 1), "new_trades": round(avg(2, 1), 1), "old_win": round(avg(1, 2), 1), "new_win": round(avg(2, 2), 1),
    "old_in": round(avg(1, 3), 1), "new_in": round(avg(2, 3), 1),
    "hold_med": round(float(np.median([r[3] for r in rows])), 1), "hold_avg": round(float(np.mean([r[3] for r in rows])), 1)}))
