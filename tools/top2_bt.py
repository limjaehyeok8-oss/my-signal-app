# 고점 신호 후보 비교: 레버리지 ETF 12종을 모아서 (신호 뒤 60거래일 안에 -20% 이상 빠진 비율, 평균 수익) · 같은 신호가 20일 안에 또 뜨면 한 번으로 셈
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
ALL = ["TQQQ","SOXL","TECL","UPRO","SPXL","TNA","FAS","LABU","FNGU","WEBL","BULZ","NVDL"]
def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean(); return 100 - 100 / (1 + up / dn)
agg = {}; base = []
for t in ALL:
    try:
        d = yf.download(t, start="2009-01-01", auto_adjust=True, progress=False); d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
        d = d.dropna(); c = d.Close; v = d.Volume
    except Exception: continue
    if len(c) < 400: continue
    sma200 = c.rolling(200).mean(); gap = c / sma200 - 1; sma50 = c.rolling(50).mean(); sma20 = c.rolling(20).mean(); sma10 = c.rolling(10).mean()
    w = c.resample("W-FRI").last(); wr = rsi(w).reindex(c.index, method="ffill"); dr = rsi(c)
    r20 = c / c.shift(20) - 1; hi60 = c.rolling(60).max(); fromhi = c / hi60 - 1
    volx = v / v.rolling(50).mean(); ret1 = c.pct_change(); rng = (d.High - d.Low) / d.Close
    f60 = c.shift(-60) / c - 1; dd60 = c[::-1].rolling(60, min_periods=60).min()[::-1].shift(-1) / c - 1
    S = {
     "A 괴리+60%": gap > 0.6,
     "B 주봉RSI 80+": wr > 80,
     "C 괴리+40% & 20일선 아래로 마감": (gap.shift(1) > 0.4) & (c < sma20) & (c.shift(1) >= sma20.shift(1)),
     "D 괴리+40% & 50일선 아래로 마감": (gap.shift(1) > 0.4) & (c < sma50) & (c.shift(1) >= sma50.shift(1)),
     "E 20일 +40% 급등 뒤 고점 대비 -10%": (r20.rolling(10).max() > 0.4) & (fromhi < -0.10) & (fromhi.shift(1) >= -0.10),
     "F 일봉RSI 80+ 뒤 10일선 이탈": (dr.rolling(5).max() > 80) & (c < sma10) & (c.shift(1) >= sma10.shift(1)),
     "G 괴리+50% & 거래량 3배 급증 + 하락 마감": (gap > 0.5) & (volx > 3) & (ret1 < 0),
     "H 괴리+40% & 하루 -7% 이상 급락": (gap.shift(1) > 0.4) & (ret1 < -0.07),
     "I 주봉RSI 70+ & 20일선 아래로 마감": (wr.shift(1) > 70) & (c < sma20) & (c.shift(1) >= sma20.shift(1)),
    }
    ok = (c.index >= "2010-09-01") & f60.notna().values
    base.append(pd.DataFrame({"f": f60[ok], "d": dd60[ok]}))
    for k, m in S.items():
        m = m.fillna(False)[ok]; idx = np.where(m.values)[0]; keep = []; last = -99
        for i in idx:
            if i - last >= 20: keep.append(i)
            last = i                                   # 연속 신호는 마지막 날 기준으로 20일 쉬어야 새 신호
        x = pd.DataFrame({"f": f60[ok].values[keep], "d": dd60[ok].values[keep]})
        agg.setdefault(k, []).append(x)
B = pd.concat(base); print(f"기준(아무 날) 표본 {len(B)} · 60일 뒤 평균 {B.f.mean()*100:.1f}% · -20% 이상 하락 {(B.d <= -0.2).mean()*100:.0f}% · 오른 비율 {(B.f > 0).mean()*100:.0f}%")
for k, L in agg.items():
    X = pd.concat(L)
    if len(X) < 15: print(f"  {k:36s} 표본 부족({len(X)})"); continue
    print(f"  {k:36s} {len(X):4d}번 · 60일 뒤 평균 {X.f.mean()*100:6.1f}% 중앙 {X.f.median()*100:6.1f}% · -20% 이상 하락 {(X.d <= -0.2).mean()*100:3.0f}% · 오른 비율 {(X.f > 0).mean()*100:3.0f}%")
