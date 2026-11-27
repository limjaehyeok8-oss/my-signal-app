# 주봉 RSI 다이버전스(하락) / RSI 70 이상 세 번 + 고점 점점 낮아짐 → 이후 60거래일 성적
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean(); return 100 - 100 / (1 + up / dn)
def signals(w):                                   # w: 주봉 종가. 반환: {날짜: 종류}
    r = rsi(w).values; c = w.values; n = len(w); out = {}
    piv = [i for i in range(2, n - 2) if c[i] >= max(c[i-2:i+3]) and not np.isnan(r[i])]      # 가격 고점 (좌우 2주보다 높음) · 확정은 2주 뒤
    for a, b in zip(piv, piv[1:]):
        if 3 <= b - a <= 30 and c[b] > c[a] and r[b] < r[a] - 3 and r[a] >= 65: out[w.index[min(b + 2, n - 1)]] = "하락 다이버전스"
    rp = [i for i in range(2, n - 2) if r[i] >= 70 and r[i] >= max(r[i-2:i+3])]               # RSI 70 이상 고점
    for k in range(2, len(rp)):
        a, b, c3 = rp[k-2], rp[k-1], rp[k]
        if c3 - a <= 60 and r[a] > r[b] > r[c3]: out[w.index[min(c3 + 2, n - 1)]] = "RSI 70+ 세 번·고점 하락"
    return out
for t in ("TQQQ", "SOXL"):
    d = yf.download(t, start="2009-01-01", auto_adjust=True, progress=False); d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
    c = d.Close.dropna(); w = c.resample("W-FRI").last().dropna(); sg = signals(w)
    f60 = c.shift(-60) / c - 1; dd = c[::-1].rolling(60, min_periods=60).min()[::-1].shift(-1) / c - 1
    print(f"== {t} 기준: 60일 뒤 평균 {f60.mean()*100:.1f}% · -20% 이상 하락 {(dd <= -0.2).mean()*100:.0f}%")
    for kind in ("하락 다이버전스", "RSI 70+ 세 번·고점 하락"):
        ds = [x for x, k in sg.items() if k == kind and x >= pd.Timestamp("2010-09-01")]
        rows = [(x, f60.asof(x), dd.asof(x)) for x in ds if not np.isnan(f60.asof(x))]
        if not rows: print(f"  {kind}: 횟수 {len(ds)} (60일 뒤 데이터 부족)"); continue
        a = np.array([[r[1], r[2]] for r in rows])
        print(f"  {kind}: {len(ds)}회 · 60일 뒤 평균 {a[:,0].mean()*100:.1f}% 중앙 {np.median(a[:,0])*100:.1f}% · -20% 이상 하락 {(a[:,1] <= -0.2).mean()*100:.0f}% · 오른 비율 {(a[:,0] > 0).mean()*100:.0f}%")
        print("    날짜:", ", ".join(str(x)[:10] for x in ds[-8:]))
