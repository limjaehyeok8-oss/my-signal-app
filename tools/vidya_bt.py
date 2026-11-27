# 레버리지 ETF 12종 전략 비교 백테스트 (봇과 같은 조건: 최대 5종목 동시, 종목당 시작자금/5 고정, 신호는 종가 → 다음날 시가 체결, 수수료 0.25%)
import yfinance as yf, pandas as pd, numpy as np, json, warnings
warnings.filterwarnings("ignore")
LIST = ["TQQQ","SOXL","TECL","UPRO","SPXL","TNA","FAS","LABU","FNGU","WEBL","BULZ","NVDL"]
FEE, SLOTS = 0.0025, 5

def vidya(c, ln, cmo=20):
    c = c.astype(float); n = len(c); out = np.full(n, np.nan)
    if n < ln: return out
    a = 2 / (ln + 1); v = c[:ln].mean()
    for i in range(ln - 1, n):
        lo = max(1, i - cmo + 1); d = np.diff(c[lo - 1:i + 1]); up = d[d > 0].sum(); dn = -d[d < 0].sum()
        k = abs(up - dn) / (up + dn) if up + dn > 0 else 0
        if i > ln - 1: v = a * k * c[i] + (1 - a * k) * v
        out[i] = v
    return out

def load(t):
    d = yf.download(t, start="2006-01-01", auto_adjust=True, progress=False)
    if d is None or len(d) < 300: return None
    d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
    return d[["Open", "Close"]].dropna()

D = {t: load(t) for t in LIST}; D = {t: d for t, d in D.items() if d is not None}
SPY = load("SPY")
print("데이터:", {t: str(d.index[0].date()) for t, d in D.items()})

def feats(d):
    c = d["Close"].values.astype(float); s = pd.Series(c, index=d.index)
    f = {"c": s}
    for n in (50, 100, 120, 200): f[f"sma{n}"] = s.rolling(n).mean()
    for n in (30, 60, 120, 200): f[f"vid{n}"] = pd.Series(vidya(c, n), index=d.index)
    f["mom126"] = s / s.shift(126) - 1; f["mom63"] = s / s.shift(63) - 1; f["mom252"] = s / s.shift(252) - 1
    return f
F = {t: feats(d) for t, d in D.items()}

# 전략: (보유조건 함수, 순위점수 함수) — 둘 다 (t, day) → 값 (NaN이면 해당 없음)
def S_vid(n):   return (lambda f, k: f["c"].iloc[k] > f[f"vid{n}"].iloc[k], lambda f, k: f["c"].iloc[k] / f[f"vid{n}"].iloc[k] - 1)
def S_sma(n):   return (lambda f, k: f["c"].iloc[k] > f[f"sma{n}"].iloc[k], lambda f, k: f["c"].iloc[k] / f[f"sma{n}"].iloc[k] - 1)
def S_vid_mom(n, m): return (lambda f, k: f["c"].iloc[k] > f[f"vid{n}"].iloc[k] and f[m].iloc[k] > 0, lambda f, k: f[m].iloc[k])
def S_mom(m, sma): return (lambda f, k: f[m].iloc[k] > 0 and f["c"].iloc[k] > f[f"sma{sma}"].iloc[k], lambda f, k: f[m].iloc[k])
def S_dual(n, m):  # VIDYA 위 + 모멘텀 순위, 청산은 VIDYA 아래일 때만
    return (lambda f, k: f["c"].iloc[k] > f[f"vid{n}"].iloc[k], lambda f, k: f[m].iloc[k])

STRATS = {
 "VIDYA 30": S_vid(30), "VIDYA 60": S_vid(60), "VIDYA 120": S_vid(120), "VIDYA 200": S_vid(200),
 "단순이평 50": S_sma(50), "단순이평 120": S_sma(120), "단순이평 200": S_sma(200),
 "VIDYA120 + 6개월모멘텀 양수·순위": S_vid_mom(120, "mom126"),
 "VIDYA120 위 + 모멘텀순위(6개월)": S_dual(120, "mom126"),
 "VIDYA60 위 + 모멘텀순위(6개월)": S_dual(60, "mom126"),
 "VIDYA200 위 + 모멘텀순위(6개월)": S_dual(200, "mom126"),
 "모멘텀(3개월)+200선": S_mom("mom63", 200), "모멘텀(6개월)+200선": S_mom("mom126", 200), "모멘텀(12개월)+200선": S_mom("mom252", 200),
}

def sim(name, hold, score, start="2010-06-01"):
    dates = sorted(set().union(*[set(d.index) for d in D.values()])); dates = [x for x in dates if x >= pd.Timestamp(start)]
    cash = 1.0; pos = {}; eq = []; trades = []
    for k in range(len(dates) - 1):
        day, nxt = dates[k], dates[k + 1]
        sig = {}
        for t, f in F.items():
            if day in f["c"].index:
                i = f["c"].index.get_loc(day)
                try:
                    h = hold(f, i); sc = score(f, i)
                    if not (np.isnan(sc)): sig[t] = (bool(h), float(sc))
                except Exception: pass
        for t in list(pos):
            if t in sig and not sig[t][0] and nxt in D[t].index:
                px = D[t].loc[nxt, "Open"] * (1 - FEE); cash += pos[t][0] * px; trades.append(px / pos[t][1] - 1); del pos[t]
        ups = sorted([t for t, (h, sc) in sig.items() if h and t not in pos and nxt in D[t].index], key=lambda t: -sig[t][1])
        for t in ups:
            if len(pos) >= SLOTS: break
            px = D[t].loc[nxt, "Open"] * (1 + FEE); bud = min(cash, 1.0 / SLOTS)
            if bud < 0.01: continue
            pos[t] = (bud / px, px); cash -= bud
        val = cash + sum(q * (D[t].loc[nxt, "Close"] if nxt in D[t].index else px0) for t, (q, px0) in pos.items())
        eq.append((nxt, val))
    return pd.Series([v for _, v in eq], index=[d for d, _ in eq]), trades

def stat(eq):
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    cagr = (eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1; mdd = (eq / eq.cummax() - 1).min()
    return cagr * 100, mdd * 100

rows = []
for nm, (h, s) in STRATS.items():
    eq, tr = sim(nm, h, s)
    cg, md = stat(eq); half = eq.index[len(eq) // 2]
    c1, m1 = stat(eq[:half]); c2, m2 = stat(eq[half:])
    wins = [x for x in tr if x > 0]
    yr = (eq.groupby(eq.index.year).last() / eq.groupby(eq.index.year).last().shift(1).fillna(1.0) - 1) * 100
    rows.append(dict(name=nm, total=round((eq.iloc[-1] - 1) * 100), cagr=round(cg, 1), mdd=round(md, 1), calmar=round(cg / abs(md), 2),
                     c1=round(c1, 1), c2=round(c2, 1), n=len(tr), win=round(len(wins) / max(1, len(tr)) * 100), avg=round(np.mean(tr) * 100, 1) if tr else 0,
                     years={int(y): round(float(v)) for y, v in yr.items()}))
    print(f"{nm:34s} 누적 {rows[-1]['total']:>6}% 연 {cg:5.1f}% MDD {md:6.1f}% 칼마 {rows[-1]['calmar']:>5} | 전반 {c1:5.1f}% 후반 {c2:5.1f}% | 거래 {len(tr)} 승률 {rows[-1]['win']}% 평균 {rows[-1]['avg']}%")
# 비교 기준
ew = pd.concat([f["c"].pct_change() for f in F.values()], axis=1).mean(axis=1).fillna(0); ewe = (1 + ew[ew.index >= "2010-06-01"]).cumprod()
cg, md = stat(ewe); print(f"{'12종 균등 보유(매일 리밸런싱)':34s} 누적 {round((ewe.iloc[-1]-1)*100)}% 연 {cg:.1f}% MDD {md:.1f}%")
sp = SPY["Close"][SPY.index >= "2010-06-01"]; sp = sp / sp.iloc[0]; cg, md = stat(sp); print(f"{'SPY 보유':34s} 누적 {round((sp.iloc[-1]-1)*100)}% 연 {cg:.1f}% MDD {md:.1f}%")
print("\n연도별(수익률%):")
for r in sorted(rows, key=lambda r: -r["calmar"])[:5]: print(r["name"], r["years"])
print("JSON=" + json.dumps(rows, ensure_ascii=False))
