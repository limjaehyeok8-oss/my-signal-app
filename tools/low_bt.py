# 주봉 초저점(저가 <= 볼린저 하단 AND 주봉 RSI14 <= 30) 매수 테스트
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
exec(open("tools/mix_bt.py").read().split("data = {t: load(t)")[0])
def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean(); return 100 - 100 / (1 + up / dn)
def ohlc(t):
    d = yf.download(t, start="2009-01-01", auto_adjust=True, progress=False); d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
    return d[["Open", "High", "Low", "Close"]].dropna()
res = {}
for t in ("TQQQ", "SOXL"):
    d = ohlc(t); c = d.Close; cv = c.values.astype(float); n = len(cv)
    w = d.resample("W-FRI").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna()
    ma = w.Close.rolling(20).mean(); sd = w.Close.rolling(20).std(); lowb = ma - 2 * sd; wr = rsi(w.Close)
    sig = (w.Low <= lowb) & (wr <= 30)
    # 일별 신호: 그 주 마지막 거래일 종가 이후 알 수 있음 (주 마지막 거래일에 True)
    lastday = d.groupby(pd.Grouper(freq="W-FRI")).apply(lambda x: x.index[-1] if len(x) else pd.NaT).dropna()
    sigd = pd.Series(False, index=d.index); wrd = pd.Series(np.nan, index=d.index)
    for wk, ld in lastday.items():
        if wk in sig.index and sig[wk]: sigd[ld] = True
        if wk in wr.index: wrd[ld] = wr[wk]
    wrd = wrd.ffill()
    s200 = c.rolling(200).mean().values; ok = ~np.isnan(s200)
    base = state(np.where(ok, (cv > s200 * 1.05).astype(float), np.nan), np.where(ok, (cv < s200 * 0.95).astype(float), np.nan))
    f = lambda k: (c.shift(-k) / c - 1)
    ev = sigd[sigd & (d.index >= "2010-09-01")].index
    print(f"== {t} 주봉 초저점 신호 {len(ev)}번: " + ", ".join(str(x)[:10] for x in ev))
    for k, nm in ((20, "4주"), (65, "13주"), (130, "26주")):
        v = f(k).reindex(ev).dropna(); print(f"   신호 뒤 {nm}: 평균 {v.mean()*100:.1f}% 중앙 {v.median()*100:.1f}% 오른 비율 {(v>0).mean()*100:.0f}% (표본 {len(v)})")
    for hold_w, thr in ((8, None), (13, None), (26, None), (None, 50), (None, 60)):
        h = base.copy(); extra = 0; since = 0
        for i in range(n):
            if np.isnan(h[i]): continue
            if extra == 0 and sigd.iloc[i]: extra = 1; since = i
            elif extra == 1:
                if (hold_w and i - since >= hold_w * 5) or (thr and wrd.iloc[i] >= thr): extra = 0
            h[i] = 1.0 if (base[i] == 1 or extra == 1) else 0.0
        sr, tr = sim(d, h); st = stat(sr); nm = f"{hold_w}주 보유" if hold_w else f"주봉RSI {thr} 넘으면 매도"
        res.setdefault(nm, {})[t] = (sr, tr); print(f"   200일선±5% + 초저점 매수({nm}): {st[0]:5.1f}% / {st[1]:6.1f}% / 칼마 {st[2]:.2f} / 전반 {st[3]:5.1f} 후반 {st[4]:5.1f} / {tr}회")
    sr, tr = sim(d, base); st = stat(sr); res.setdefault("기준", {})[t] = (sr, tr); print(f"   기준(200일선±5%만): {st[0]:5.1f}% / {st[1]:6.1f}% / 칼마 {st[2]:.2f} / 전반 {st[3]:5.1f} 후반 {st[4]:5.1f} / {tr}회")
print("== 반반")
for nm, v in res.items():
    j = pd.concat([v["TQQQ"][0], v["SOXL"][0]], axis=1).dropna(); mix = (j.pct_change().mean(axis=1).fillna(0) + 1).cumprod(); st = stat(mix)
    print(f"   {nm:18s} {st[0]:5.1f}% / {st[1]:6.1f}% / 칼마 {st[2]:.2f} / 전반 {st[3]:5.1f} 후반 {st[4]:5.1f} / {v['TQQQ'][1] + v['SOXL'][1]}회")
