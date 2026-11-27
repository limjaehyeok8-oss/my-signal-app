# 영상 방식(2일 단순이평 vs VIDYA 120 교차)과 현재 방식(종가 vs 200일선)을 TQQQ·SOXL에서 비교
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
FEE = 0.0025
def vidya(c, ln, cmo=20):
    n = len(c); out = np.full(n, np.nan); a = 2 / (ln + 1); v = c[:ln].mean()
    for i in range(ln - 1, n):
        lo = max(1, i - cmo + 1); d = np.diff(c[lo - 1:i + 1]); up = d[d > 0].sum(); dn = -d[d < 0].sum()
        k = abs(up - dn) / (up + dn) if up + dn > 0 else 0
        if i > ln - 1: v = a * k * c[i] + (1 - a * k) * v
        out[i] = v
    return out
def load(t):
    d = yf.download(t, start="2009-01-01", auto_adjust=True, progress=False)
    d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
    return d[["Open", "Close"]].dropna()
def bt(d, sig, start="2010-06-01"):
    o = d["Open"].values; c = d["Close"].values; idx = d.index; n = len(c)
    pos = 0; cash = 1.0; q = 0.0; eq = np.full(n, np.nan); trades = 0; ent = 0; w = 0
    for k in range(n - 1):
        if idx[k] >= pd.Timestamp(start) and not np.isnan(sig[k]):
            want = bool(sig[k])
            if want and q == 0: px = o[k + 1] * (1 + FEE); q = cash / px; cash = 0; ent = px; trades += 1
            elif not want and q > 0: px = o[k + 1] * (1 - FEE); cash = q * px; q = 0; w += px > ent
        eq[k + 1] = cash + q * c[k + 1] if idx[k + 1] >= pd.Timestamp(start) else np.nan
    s = pd.Series(eq, index=idx).dropna(); s = s / s.iloc[0]
    yrs = (s.index[-1] - s.index[0]).days / 365.25
    return round((s.iloc[-1] ** (1 / yrs) - 1) * 100, 1), round((s / s.cummax() - 1).min() * 100, 1), trades, round(s.iloc[-1], 1)
for t in ("TQQQ", "SOXL"):
    d = load(t); c = d["Close"]; cv = c.values.astype(float)
    sma = lambda n: c.rolling(n).mean().values
    print("==", t, "연수익% / 최대낙폭% / 매매횟수 / 최종배수")
    for name, sig in [
        ("영상: SMA2 > VIDYA120", np.where(np.isnan(vidya(cv, 120)), np.nan, (sma(2) > vidya(cv, 120)).astype(float))),
        ("종가 > VIDYA120", np.where(np.isnan(vidya(cv, 120)), np.nan, (cv > vidya(cv, 120)).astype(float))),
        ("SMA2 > VIDYA60", np.where(np.isnan(vidya(cv, 60)), np.nan, (sma(2) > vidya(cv, 60)).astype(float))),
        ("현재: 종가 > 200일선", np.where(np.isnan(sma(200)), np.nan, (cv > sma(200)).astype(float))),
        ("SMA2 > 200일선", np.where(np.isnan(sma(200)), np.nan, (sma(2) > sma(200)).astype(float))),
        ("그냥 보유", np.ones(len(cv)))]:
        print(f"{name:26s}", *bt(d, sig))
