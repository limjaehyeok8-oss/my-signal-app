# 매수 신호와 매도 신호를 서로 다른 선으로 섞어보기 (TQQQ, SOXL 각각 + 둘 합쳐 반반)
import yfinance as yf, pandas as pd, numpy as np, warnings, itertools
warnings.filterwarnings("ignore")
exec(open("tools/sma2_bt.py").read().split("for t in (")[0])   # vidya, load, FEE 재사용
START = pd.Timestamp("2010-06-01")
def lines(c):
    cv = c.values.astype(float); L = {}
    for n in (50, 100, 200): L[f"SMA{n}"] = c.rolling(n).mean().values
    L["SMA2"] = c.rolling(2).mean().values
    for n in (30, 60, 120, 200): L[f"VIDYA{n}"] = vidya(cv, n)
    L["종가"] = cv
    return L
def state(buy, sell):
    n = len(buy); h = np.zeros(n); cur = 0
    for i in range(n):
        if np.isnan(buy[i]) or np.isnan(sell[i]): h[i] = np.nan; continue
        if cur == 0 and buy[i]: cur = 1
        elif cur == 1 and sell[i]: cur = 0
        h[i] = cur
    return h
def sim(d, h):
    o = d["Open"].values; c = d["Close"].values; idx = d.index; n = len(c)
    cash = 1.0; q = 0.0; eq = np.full(n, np.nan); tr = 0
    for k in range(n - 1):
        if idx[k] >= START and not np.isnan(h[k]):
            if h[k] == 1 and q == 0: q = cash / (o[k + 1] * (1 + FEE)); cash = 0; tr += 1
            elif h[k] == 0 and q > 0: cash = q * o[k + 1] * (1 - FEE); q = 0
        if idx[k + 1] >= START: eq[k + 1] = cash + q * c[k + 1]
    s = pd.Series(eq, index=idx).dropna(); return s / s.iloc[0], tr
def stat(s):
    yrs = (s.index[-1] - s.index[0]).days / 365.25; cg = s.iloc[-1] ** (1 / yrs) - 1; md = (s / s.cummax() - 1).min()
    mid = s.index[len(s) // 2]; a = s[:mid]; b = s[mid:]
    f = lambda x: (x.iloc[-1] / x.iloc[0]) ** (365.25 / max(1, (x.index[-1] - x.index[0]).days)) - 1
    return cg * 100, md * 100, cg / abs(md), f(a) * 100, f(b) * 100
BUYS = ["종가>SMA200", "SMA2>SMA200", "종가>VIDYA120", "SMA2>VIDYA120"]
SELLS = ["종가<SMA200", "종가<SMA100", "종가<SMA50", "종가<VIDYA30", "종가<VIDYA60", "종가<VIDYA120", "SMA2<VIDYA60", "SMA2<VIDYA120", "SMA2<SMA200"]
def cond(L, name):
    a, op, b = name.replace(">", " > ").replace("<", " < ").split(); x = L[a]; y = L[b]
    return (x > y) if op == ">" else (x < y)
data = {t: load(t) for t in ("TQQQ", "SOXL")}; Ls = {t: lines(data[t]["Close"]) for t in data}
rows = []; eqs = {}
for bn, sn in itertools.product(BUYS, SELLS):
    ss = {}
    for t in data:
        L = Ls[t]; buy = np.where(np.isnan(L["SMA200"]) | np.isnan(L["VIDYA120"]), np.nan, cond(L, bn).astype(float)); sell = np.where(np.isnan(L["SMA200"]) | np.isnan(L["VIDYA120"]), np.nan, cond(L, sn).astype(float))
        s, tr = sim(data[t], state(buy, sell)); ss[t] = (s, tr)
    for t in data:
        rows.append((t, bn, sn, *stat(ss[t][0]), ss[t][1]))
    j = pd.concat([ss["TQQQ"][0], ss["SOXL"][0]], axis=1).dropna(); mix = (j.pct_change().mean(axis=1).fillna(0) + 1).cumprod()   # 매일 반반 재조정
    rows.append(("반반", bn, sn, *stat(mix), ss["TQQQ"][1] + ss["SOXL"][1]))
df = pd.DataFrame(rows, columns=["종목", "매수", "매도", "연수익", "최대낙폭", "칼마", "전반", "후반", "횟수"])
for t in ("TQQQ", "SOXL", "반반"):
    print("==", t, "(칼마=연수익/낙폭, 전반/후반=기간 나눠본 연수익)")
    x = df[df.종목 == t]
    base = x[(x.매수 == "종가>SMA200") & (x.매도 == "종가<SMA200")].iloc[0]
    print("기준(현재 방식):", f"{base.연수익:.1f}% / {base.최대낙폭:.1f}% / 칼마 {base.칼마:.2f} / 전반 {base.전반:.1f} 후반 {base.후반:.1f} / {int(base.횟수)}회")
    for _, r in x.sort_values("칼마", ascending=False).head(6).iterrows():
        print(f"  {r.매수:14s} 매수 → {r.매도:12s} 매도  {r.연수익:5.1f}% / {r.최대낙폭:6.1f}% / 칼마 {r.칼마:.2f} / 전반 {r.전반:5.1f} 후반 {r.후반:5.1f} / {int(r.횟수)}회")
print("== 매수만 VIDYA로 (더 빨리 사는지) · 매도는 200일선")
for t in ("TQQQ", "SOXL", "반반"):
    x = df[(df.종목 == t) & (df.매도 == "종가<SMA200")]
    for _, r in x.iterrows():
        print(f"  {t:5s} {r.매수:14s} 매수 → 종가<SMA200 매도  {r.연수익:5.1f}% / {r.최대낙폭:6.1f}% / 칼마 {r.칼마:.2f} / 전반 {r.전반:5.1f} 후반 {r.후반:5.1f} / {int(r.횟수)}회")
