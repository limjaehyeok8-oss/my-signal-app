# 고점 신호(저점의 반대): 주봉 RSI 높음 + 주봉 고가가 볼린저 상단 이상 → 이후 4·13·26주 성적 (레버리지 12종 합산, 연속 신호는 4주에 한 번만)
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
ALL = ["TQQQ","SOXL","TECL","UPRO","SPXL","TNA","FAS","LABU","FNGU","WEBL","BULZ","NVDL"]
def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean(); return 100 - 100 / (1 + up / dn)
names = ["전체 주(기준)", "RSI≥80 + 볼린저상단", "RSI≥75 + 볼린저상단", "RSI 70~75 + 볼린저상단", "RSI≥70 만", "볼린저상단만(RSI<70)", "RSI≥80 만"]
rows = {k: [] for k in names}; allw = []
for t in ALL:
    try:
        d = yf.download(t, start="2009-01-01", auto_adjust=True, progress=False); d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
        w = d.resample("W-FRI").agg({"High": "max", "Low": "min", "Close": "last"}).dropna()
    except Exception: continue
    if len(w) < 80: continue
    r = rsi(w.Close); ub = w.Close.rolling(20).mean() + 2 * w.Close.rolling(20).std(); touch = w.High >= ub
    f = {k: w.Close.shift(-k) / w.Close - 1 for k in (4, 13, 26)}
    dd13 = pd.Series([w.Close.iloc[i+1:i+14].min() / w.Close.iloc[i] - 1 if i + 14 <= len(w) else np.nan for i in range(len(w))], index=w.index)
    ok = (w.index >= "2010-09-01")
    conds = {"전체 주(기준)": r.notna(), "RSI≥80 + 볼린저상단": (r >= 80) & touch, "RSI≥75 + 볼린저상단": (r >= 75) & touch, "RSI 70~75 + 볼린저상단": (r >= 70) & (r < 75) & touch, "RSI≥70 만": r >= 70, "볼린저상단만(RSI<70)": touch & (r < 70), "RSI≥80 만": r >= 80}
    for k, m in conds.items():
        m = (m & ok).fillna(False); idx = np.where(m.values)[0]; keep = []; last = -9
        for i in idx:
            if k == "전체 주(기준)" or i - last >= 4: keep.append(i)
            last = i
        rows[k].append(pd.DataFrame({4: f[4].values[keep], 13: f[13].values[keep], 26: f[26].values[keep], "dd": dd13.values[keep]}))
for k, L in rows.items():
    X = pd.concat(L); n = len(X)
    if n < 10: print(f"{k:26s} 표본 부족({n})"); continue
    print(f"{k:26s} {n:5d}번 · 4주 평균 {X[4].mean()*100:5.1f}% (오른 {(X[4]>0).mean()*100:3.0f}%) · 13주 평균 {X[13].mean()*100:6.1f}% (오른 {(X[13]>0).mean()*100:3.0f}%) · 26주 평균 {X[26].mean()*100:6.1f}% · 13주 안에 -20% 이상 하락 {(X['dd']<=-0.2).mean()*100:3.0f}%")
