# VIDYA(120) 레버리지 ETF 백테스트 — 앱의 VIDYA봇과 같은 규칙
# 규칙: 종가가 VIDYA(120) 위면 보유, 아래면 청산. 신호는 종가 기준 → 다음 날 시가 체결, 수수료 0.25%.
import yfinance as yf, pandas as pd, numpy as np, json
LIST = ["TQQQ","SOXL","TECL","UPRO","SPXL","TNA","FAS","LABU","FNGU","WEBL","BULZ","NVDL"]
LEN, CMO, FEE, SLOTS = 120, 20, 0.0025, 5

def vidya(c, ln=LEN, cmo=CMO):
    c = c.values.astype(float); n = len(c); out = np.full(n, np.nan)
    if n < ln: return out
    a = 2 / (ln + 1); v = c[:ln].mean()
    for i in range(ln - 1, n):
        lo = max(1, i - cmo + 1); d = np.diff(c[lo - 1:i + 1]); up = d[d > 0].sum(); dn = -d[d < 0].sum()
        k = abs(up - dn) / (up + dn) if up + dn > 0 else 0
        if i > ln - 1: v = a * k * c[i] + (1 - a * k) * v
        out[i] = v
    return out

def get(t):
    d = yf.download(t, start="2006-01-01", auto_adjust=True, progress=False)
    if d is None or len(d) == 0: return None
    d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
    return d[["Open", "Close"]].dropna()

def stats(eq, label):
    eq = pd.Series(eq).dropna(); yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    tot = eq.iloc[-1] / eq.iloc[0] - 1; cagr = (eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1 if yrs > 0 else 0
    mdd = (eq / eq.cummax() - 1).min()
    return dict(total=round(tot * 100, 1), cagr=round(cagr * 100, 1), mdd=round(mdd * 100, 1), yrs=round(yrs, 1))

data = {}
for t in LIST:
    d = get(t)
    if d is not None and len(d) > 300:
        d["v"] = vidya(d["Close"]); data[t] = d
print("데이터:", {t: (str(d.index[0].date()), len(d)) for t, d in data.items()})

res = {"per": {}, "rule": f"VIDYA({LEN}) · CMO {CMO} · 수수료 {FEE*100:.2f}% · 다음날 시가 체결"}
# 종목별 (전액 투자/현금, 복리)
for t, d in data.items():
    d = d.dropna(); c = d["Close"].values; o = d["Open"].values; v = d["v"].values
    inpos = False; eq = [1.0]; ent = None; trades = []; cash = 1.0; sh = 0.0
    for i in range(len(d) - 1):
        want = c[i] > v[i]
        if want and not inpos:
            px = o[i + 1] * (1 + FEE); sh = cash / px; cash = 0; inpos = True; ent = px
        elif not want and inpos:
            px = o[i + 1] * (1 - FEE); cash = sh * px; sh = 0; inpos = False; trades.append(px / ent - 1)
        eq.append(cash + sh * c[i + 1])
    eqs = pd.Series(eq, index=d.index); bh = pd.Series(d["Close"].values / d["Close"].values[0], index=d.index)
    s = stats(eqs, t); b = stats(bh, t)
    wins = [x for x in trades if x > 0]
    res["per"][t] = dict(start=str(d.index[0].date()), vid=s, bh=b, n=len(trades), win=round(len(wins) / len(trades) * 100) if trades else 0,
                         avg=round(np.mean(trades) * 100, 1) if trades else 0)
    print(f"{t:5s} {d.index[0].date()}  VIDYA 누적 {s['total']:>9}% 연 {s['cagr']:>6}% MDD {s['mdd']:>6}% | 보유만 누적 {b['total']:>9}% 연 {b['cagr']:>6}% MDD {b['mdd']:>6}% | 거래 {len(trades)} 승률 {res['per'][t]['win']}%")

# 포트폴리오 (봇과 같은 방식: 최대 5종목 동시, 종목당 시작자금/5 고정 예산, 강도순)
spy = get("SPY")
dates = sorted(set().union(*[set(d.dropna().index) for d in data.values()]))
dates = [x for x in dates if x >= pd.Timestamp("2010-01-01")]
cash = 1.0; pos = {}; eq = []; trades = []; START = 1.0
for k, day in enumerate(dates[:-1]):
    nxt = dates[k + 1]
    sig = {}
    for t, d in data.items():
        if day in d.index and not np.isnan(d.loc[day, "v"]):
            sig[t] = d.loc[day, "Close"] / d.loc[day, "v"] - 1
    # 오늘 신호로 내일 시가 체결
    for t in list(pos):
        if t in sig and sig[t] <= 0 and nxt in data[t].index:
            px = data[t].loc[nxt, "Open"] * (1 - FEE); cash += pos[t][0] * px; trades.append(px / pos[t][1] - 1); del pos[t]
    ups = sorted([t for t, g in sig.items() if g > 0 and t not in pos and nxt in data[t].index], key=lambda t: -sig[t])
    for t in ups:
        if len(pos) >= SLOTS: break
        px = data[t].loc[nxt, "Open"] * (1 + FEE); bud = min(cash, START / SLOTS)
        if bud < 0.01: continue
        pos[t] = (bud / px, px); cash -= bud
    val = cash + sum(q * (data[t].loc[nxt, "Close"] if nxt in data[t].index else px0) for t, (q, px0) in pos.items())
    eq.append((nxt, val))
eqs = pd.Series([v for _, v in eq], index=[d for d, _ in eq])
ps = stats(eqs, "포트폴리오"); sp = stats(spy["Close"].reindex(eqs.index).ffill() / spy["Close"].reindex(eqs.index).ffill().iloc[0], "SPY")
wins = [x for x in trades if x > 0]
res["port"] = dict(vid=ps, spy=sp, n=len(trades), win=round(len(wins) / len(trades) * 100) if trades else 0, avg=round(np.mean(trades) * 100, 1),
                   start=str(eqs.index[0].date()), end=str(eqs.index[-1].date()), slots=SLOTS)
yr = (eqs.groupby(eqs.index.year).last() / eqs.groupby(eqs.index.year).last().shift(1).fillna(1.0) - 1) * 100
res["port"]["years"] = {int(y): round(float(v), 1) for y, v in yr.items()}
print("\n[포트폴리오 5종목 동시]", res["port"])
print("JSON=" + json.dumps(res, ensure_ascii=False))
