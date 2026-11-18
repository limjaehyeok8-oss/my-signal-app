import numpy as np, yfinance as yf
for T in ("NVDA", "GOOG"):
    df = yf.download(T, period="5y", interval="1d", auto_adjust=False, progress=False)
    df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]; df = df.dropna(subset=["Close"])
    c = df["Close"].to_numpy(); l = df["Low"].to_numpy(); v = df["Volume"].to_numpy().astype(float); n0 = len(c)
    ma = np.array([np.nan]*20 + [c[i-19:i+1].mean() for i in range(19, n0)])[:n0]
    ma = np.array([c[max(0,i-19):i+1].mean() if i >= 19 else np.nan for i in range(n0)]); sd = np.array([c[i-19:i+1].std() if i >= 19 else np.nan for i in range(n0)]); lo = ma - 2*sd
    drops = []; prev = False; last = -99
    for k in range(n0 - 60):
        bl = lo[k] > 0 and c[k] < lo[k]
        if bl and not prev and k - last >= 10: last = k; drops.append(min(0, l[k+1:k+61].min()/lo[k]-1))
        prev = bl
    print("RES", T, "5y봉", n0, "과거 하단이탈", len(drops), "중앙", np.median(drops) if drops else None)
    n = 90; V = v[-n:]; C = c[-n:]; LO = lo[-n:]; vs = np.sort(V); med = vs[n//2]; p85 = vs[int(n*0.85)]
    print("RES   med %.0f p85 %.0f(%.2f배) 마지막 날짜 %s" % (med, p85, p85/med, df.index[-1].date()))
    for i in range(n-12, n):
        pk = all(V[j] <= V[i] for j in range(max(0,i-5), min(n,i+6)))
        print("RES   %s 거래량 %.2f배(중앙값) 상위%% %.0f 국소최대 %s 종가<하단 %s (종가 %.1f 하단 %.1f)" % (df.index[-n+i].date(), V[i]/med, 100*(V<V[i]).mean(), pk, C[i] < LO[i], C[i], LO[i]))
