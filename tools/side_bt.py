# 횡보장 거르기: 200일선 근처 오르내림에서 사고팔지 않기 (밴드·기울기·변동폭 조건)
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
exec(open("tools/mix_bt.py").read().split("data = {t: load(t)")[0])
def load_ohlc(t):
    d = yf.download(t, start="2009-01-01", auto_adjust=True, progress=False)
    d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
    return d[["Open", "High", "Low", "Close"]].dropna()
D = {t: load_ohlc(t) for t in ("TQQQ", "SOXL")}
def cases(d):
    cl = d.Close; cv = cl.values.astype(float); s = cl.rolling(200).mean().values; ok = ~np.isnan(s)
    V = lambda x: np.where(ok, x.astype(float), np.nan)
    slope = cl.rolling(200).mean().pct_change(20).values                      # 200일선이 20일간 얼마나 올랐나
    rng = ((d.High - d.Low) / d.Close).rolling(20).mean().values               # 최근 20일 평균 하루 변동폭
    er = (abs(cl - cl.shift(30)) / cl.diff().abs().rolling(30).sum()).values   # 효율비: 낮을수록 제자리 걸음(횡보)
    C = {"기준: 200일선 위·아래": state(V(cv > s), V(cv <= s))}
    for b in (0.02, 0.05, 0.08):
        C[f"밴드 ±{int(b*100)}%: 선+{int(b*100)}% 위 매수 · 선−{int(b*100)}% 아래 매도"] = state(V(cv > s * (1 + b)), V(cv < s * (1 - b)))
    C["매수만 200일선 기울기 상승일 때 (매도는 그대로)"] = state(V((cv > s) & (slope > 0)), V(cv <= s))
    C["밴드 3% + 기울기 상승일 때만 매수"] = state(V((cv > s * 1.03) & (slope > 0)), V(cv < s * 0.97))
    for th in (0.2, 0.3):
        C[f"횡보(효율비<{th})면 새로 매수 안 함"] = state(V((cv > s) & (er > th)), V(cv <= s))
    C["매수 후 최소 10일은 매도 안 함"] = None
    return C
def min_hold(d, days=10):
    cl = d.Close; cv = cl.values.astype(float); s = cl.rolling(200).mean().values; n = len(cv); h = np.full(n, np.nan); cur = 0; since = 0
    for i in range(n):
        if np.isnan(s[i]): continue
        if cur == 0 and cv[i] > s[i]: cur = 1; since = i
        elif cur == 1 and cv[i] <= s[i] and i - since >= days: cur = 0
        h[i] = cur
    return h
res = {}
for t, d in D.items():
    C = cases(d); C["매수 후 최소 10일은 매도 안 함"] = min_hold(d, 10)
    print("==", t, "연수익 / 최대낙폭 / 칼마 / 전반 후반 / 매매횟수")
    for k, h in C.items():
        sr, tr = sim(d, h); st = stat(sr); res.setdefault(k, {})[t] = (sr, st, tr)
        print(f"  {k:46s} {st[0]:5.1f}% / {st[1]:6.1f}% / {st[2]:.2f} / {st[3]:5.1f} {st[4]:5.1f} / {tr}회")
print("== 반반(매일 균등 재조정)")
for k, v in res.items():
    j = pd.concat([v["TQQQ"][0], v["SOXL"][0]], axis=1).dropna(); mix = (j.pct_change().mean(axis=1).fillna(0) + 1).cumprod(); st = stat(mix)
    print(f"  {k:46s} {st[0]:5.1f}% / {st[1]:6.1f}% / {st[2]:.2f} / {st[3]:5.1f} {st[4]:5.1f} / {v['TQQQ'][2] + v['SOXL'][2]}회")
import json
v = res["밴드 ±5%: 선+5% 위 매수 · 선−5% 아래 매도"]
j = pd.concat([v["TQQQ"][0], v["SOXL"][0]], axis=1).dropna(); mix = (j.pct_change().mean(axis=1).fillna(0) + 1).cumprod()
m = mix.resample("ME").last()
print("CURVE=" + json.dumps([[str(i)[:7], round(float(x), 2)] for i, x in m.items()]))
