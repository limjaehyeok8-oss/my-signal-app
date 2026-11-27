# 중간 저점: 주봉 RSI 30 초과~40 이하 + 볼린저 하단 이하 / RSI≤40 만 → 이후 4·13·26주 성적 (레버리지 12종 합산)
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
ALL = ["TQQQ","SOXL","TECL","UPRO","SPXL","TNA","FAS","LABU","FNGU","WEBL","BULZ","NVDL"]
def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean(); return 100 - 100 / (1 + up / dn)
rows = {k: [] for k in ("기준", "RSI≤30", "RSI 30~40 + 볼린저하단", "RSI 30~40 (볼린저 무관)", "볼린저하단만 (RSI>40)")}
for t in ALL:
    try:
        d = yf.download(t, start="2009-01-01", auto_adjust=True, progress=False); d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
        w = d.resample("W-FRI").agg({"Low": "min", "Close": "last"}).dropna()
    except Exception: continue
    if len(w) < 80: continue
    r = rsi(w.Close); lb = w.Close.rolling(20).mean() - 2 * w.Close.rolling(20).std(); touch = w.Low <= lb
    f = {k: w.Close.shift(-k) / w.Close - 1 for k in (4, 13, 26)}; ok = (w.index >= "2010-09-01")
    conds = {"기준": r.notna(), "RSI≤30": r <= 30, "RSI 30~40 + 볼린저하단": (r > 30) & (r <= 40) & touch, "RSI 30~40 (볼린저 무관)": (r > 30) & (r <= 40), "볼린저하단만 (RSI>40)": touch & (r > 40)}
    for k, m in conds.items():
        m = (m & ok).fillna(False); idx = np.where(m.values)[0]; keep = []; last = -9
        for i in idx:
            if i - last >= 4: keep.append(i)         # 4주 안에 연달아 뜬 건 한 번으로
            last = i
        rows[k].append(pd.DataFrame({4: f[4].values[keep], 13: f[13].values[keep], 26: f[26].values[keep]}))
for k, L in rows.items():
    X = pd.concat(L); n = len(X)
    print(f"{k:26s} {n:4d}번 · 4주 평균 {X[4].mean()*100:5.1f}% (오른 {(X[4]>0).mean()*100:3.0f}%) · 13주 평균 {X[13].mean()*100:5.1f}% (오른 {(X[13]>0).mean()*100:3.0f}%) · 26주 평균 {X[26].mean()*100:6.1f}% (오른 {(X[26]>0).mean()*100:3.0f}%)")
