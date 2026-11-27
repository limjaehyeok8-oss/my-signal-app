# 과열(고점) 지표가 실제로 고점을 알려줬나: 신호가 뜬 뒤 60거래일 수익률·60일 안에 고점 대비 -20% 이상 빠진 비율
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean(); return 100 - 100 / (1 + up / dn)
for t in ("TQQQ", "SOXL"):
    d = yf.download(t, start="2009-01-01", auto_adjust=True, progress=False); d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
    c = d.Close.dropna(); c = c[c.index >= "2010-06-01"] if False else c
    gap = c / c.rolling(200).mean() - 1
    w = c.resample("W-FRI").last(); wr = rsi(w).reindex(c.index, method="ffill")
    dr = rsi(c); ma20 = c.rolling(20).mean(); sd = c.rolling(20).std(); pctb = (c - (ma20 - 2 * sd)) / (4 * sd)
    r3 = c / c.shift(63) - 1; hi52 = c / c.rolling(252).max()
    F = pd.DataFrame({"ret60": c.shift(-60) / c - 1, "dd60": c[::-1].rolling(60, min_periods=60).min()[::-1].shift(-1) / c - 1}, index=c.index)
    F = F[c.index >= "2010-09-01"]
    base = F.dropna(); print(f"== {t} 기준(아무 날): 60일 뒤 평균 {base.ret60.mean()*100:.1f}% · 중앙 {base.ret60.median()*100:.1f}% · 60일 안에 -20% 이상 하락한 비율 {(base.dd60 <= -0.2).mean()*100:.0f}% · 표본 {len(base)}일")
    tests = {"200일선 대비 +60% 이상": gap > 0.6, "200일선 대비 +80% 이상": gap > 0.8, "주봉 RSI 80 이상": wr > 80, "일봉 RSI 85 이상": dr > 85,
             "볼린저 상단 위(%b>1)": pctb > 1, "3개월 +80% 이상": r3 > 0.8, "3개월 +120% 이상": r3 > 1.2, "복수: 200일선+60% & 주봉RSI80": (gap > 0.6) & (wr > 80)}
    for k, m in tests.items():
        x = F[m.reindex(F.index).fillna(False)].dropna()
        if len(x) < 20: print(f"  {k:30s} 표본 부족({len(x)})"); continue
        print(f"  {k:30s} 일수 {len(x):4d} · 60일 뒤 평균 {x.ret60.mean()*100:6.1f}% 중앙 {x.ret60.median()*100:6.1f}% · -20%이상 하락 {(x.dd60 <= -0.2).mean()*100:3.0f}% · 오른 비율 {(x.ret60 > 0).mean()*100:3.0f}%")
