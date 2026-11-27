import yfinance as yf, pandas as pd, numpy as np, warnings, json
warnings.filterwarnings("ignore")
exec(open("tools/mix_bt.py").read().split("data = {t: load(t)")[0])
d = yf.download("UPRO", start="2009-01-01", auto_adjust=True, progress=False)
d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]; d = d[["Open", "Close"]].dropna()
cl = d.Close; cv = cl.values.astype(float); s = cl.rolling(200).mean().values; ok = ~np.isnan(s)
V = lambda x: np.where(ok, x.astype(float), np.nan)
cases = {"UPRO 그냥 보유": np.where(ok, 1.0, np.nan), "UPRO 200일선": state(V(cv > s), V(cv <= s)), "UPRO 200일선 ±5%": state(V(cv > s * 1.05), V(cv < s * 0.95))}
for k, h in cases.items():
    sr, tr = sim(d, h); st = stat(sr); print(f"{k:20s} {st[0]:5.1f}% / {st[1]:6.1f}% / {st[2]:.2f} / {st[3]:5.1f} {st[4]:5.1f} / {tr}회")
    if k == "UPRO 그냥 보유":
        m = sr.resample("ME").last(); print("CURVE=" + json.dumps([[str(i)[:7], round(float(x), 2)] for i, x in m.items()]))
