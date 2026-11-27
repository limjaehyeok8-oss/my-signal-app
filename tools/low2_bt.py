# 주봉 RSI 30 이하는 얼마나 자주 있었나 + 조건을 바꿔 보면 (BB 조건 없이 / RSI 35)
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
exec(open("tools/mix_bt.py").read().split("data = {t: load(t)")[0])
def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean(); return 100 - 100 / (1 + up / dn)
def ohlc(t):
    d = yf.download(t, start="2009-01-01", auto_adjust=True, progress=False); d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
    return d[["Open", "High", "Low", "Close"]].dropna()
def episodes(m, gap=8):
    ev = []; last = None
    for x in m[m].index:
        if last is None or (x - last).days > gap * 7: ev.append(x)
        last = x
    return ev
res = {}
for t in ("QQQ", "TQQQ", "SOXL"):
    d = ohlc(t); w = d.resample("W-FRI").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna()
    wr = rsi(w.Close); ma = w.Close.rolling(20).mean(); sd = w.Close.rolling(20).std(); lowb = ma - 2 * sd
    w = w[w.index >= "2010-06-01"]; wr = wr[w.index]
    a = wr <= 30; b = a & (w.Low <= lowb[w.index])
    print(f"== {t}: 주봉 RSI≤30 {a.sum()}주 (서로 다른 구간 {len(episodes(a))}번) · RSI≤30 AND 볼린저하단 {b.sum()}주 ({len(episodes(b))}번)")
    print("   RSI≤30 구간 시작:", ", ".join(str(x)[:10] for x in episodes(a)))
    print("   둘 다 충족 주:", ", ".join(str(x)[:10] for x in b[b].index))
    print("   지금 주봉 RSI:", round(float(wr.iloc[-1]), 1))
    if t == "QQQ": continue
    c = d.Close; cv = c.values.astype(float); n = len(cv); s200 = c.rolling(200).mean().values; ok = ~np.isnan(s200)
    base = state(np.where(ok, (cv > s200 * 1.05).astype(float), np.nan), np.where(ok, (cv < s200 * 0.95).astype(float), np.nan))
    rd = pd.Series(np.nan, index=d.index)
    lastday = d.groupby(pd.Grouper(freq="W-FRI")).apply(lambda x: x.index[-1] if len(x) else pd.NaT).dropna()
    rsiW = rsi(d.resample("W-FRI").last().Close.dropna())
    wlow = d.resample("W-FRI").Low.min()
    def run(cond):
        sig = pd.Series(False, index=d.index)
        for wk, ld in lastday.items():
            if wk in cond.index and cond[wk]: sig[ld] = True
        for wk, ld in lastday.items():
            if wk in rsiW.index: rd[ld] = rsiW[wk]
        r2 = rd.ffill(); h = base.copy(); ex = 0
        for i in range(n):
            if np.isnan(h[i]): continue
            if ex == 0 and sig.iloc[i]: ex = 1
            elif ex == 1 and r2.iloc[i] >= 60: ex = 0
            h[i] = 1.0 if (base[i] == 1 or ex == 1) else 0.0
        return sim(d, h)
    full = d.resample("W-FRI").agg({"Low": "min", "Close": "last"}).dropna(); lb = (full.Close.rolling(20).mean() - 2 * full.Close.rolling(20).std()); rw = rsi(full.Close)
    for nm, cond in (("RSI≤30 + 볼린저하단 (현재 규칙)", (rw <= 30) & (full.Low <= lb)), ("RSI≤30 만", rw <= 30), ("RSI≤35 + 볼린저하단", (rw <= 35) & (full.Low <= lb)), ("RSI≤35 만", rw <= 35)):
        sr, tr = run(cond); st = stat(sr); res.setdefault(nm, {})[t] = (sr, tr); print(f"   {nm:24s} {st[0]:5.1f}% / {st[1]:6.1f}% / 칼마 {st[2]:.2f} / 전반 {st[3]:5.1f} 후반 {st[4]:5.1f} / {tr}회")
print("== 반반")
for nm, v in res.items():
    j = pd.concat([v["TQQQ"][0], v["SOXL"][0]], axis=1).dropna(); mix = (j.pct_change().mean(axis=1).fillna(0) + 1).cumprod(); st = stat(mix)
    print(f"   {nm:24s} {st[0]:5.1f}% / {st[1]:6.1f}% / 칼마 {st[2]:.2f} / 전반 {st[3]:5.1f} 후반 {st[4]:5.1f} / {v['TQQQ'][1] + v['SOXL'][1]}회")
