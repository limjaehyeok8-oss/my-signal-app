# 레버리지 ETF 전략 비교 2차: 복리 운용(수익을 다시 투자) + 종목 풀·보유 종목 수·신호 종류 조합
import yfinance as yf, pandas as pd, numpy as np, json, warnings, itertools
warnings.filterwarnings("ignore")
ALL = ["TQQQ","SOXL","TECL","UPRO","SPXL","TNA","FAS","LABU","FNGU","WEBL","BULZ","NVDL"]
POOLS = {"전체 12종": ALL, "핵심 4종(TQQQ·SOXL·TECL·UPRO)": ["TQQQ","SOXL","TECL","UPRO"], "지수 3종(TQQQ·UPRO·TNA)": ["TQQQ","UPRO","TNA"], "TQQQ 하나": ["TQQQ"], "TQQQ+SOXL": ["TQQQ","SOXL"]}
FEE = 0.0025

def vidya(c, ln, cmo=20):
    n = len(c); out = np.full(n, np.nan)
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
raw = {t: load(t) for t in ALL}; raw = {t: d for t, d in raw.items() if d is not None}
SPY = load("SPY")
START = pd.Timestamp("2010-06-01")
idx = pd.DatetimeIndex(sorted(set().union(*[set(d.index) for d in raw.values()])))
idx = idx[idx >= START]
O = pd.DataFrame({t: d["Open"] for t, d in raw.items()}).reindex(idx); C = pd.DataFrame({t: d["Close"] for t, d in raw.items()}).reindex(idx)
Cf = pd.DataFrame({t: d["Close"] for t, d in raw.items()}).reindex(idx.union(pd.DatetimeIndex([]))).copy()
full = {t: d["Close"] for t, d in raw.items()}
def sig_frames():
    S = {}
    for n in (30, 60, 120, 200):
        S[f"VIDYA {n}"] = pd.DataFrame({t: pd.Series(vidya(full[t].values.astype(float), n), index=full[t].index) for t in raw}).reindex(idx)
    for n in (50, 100, 200): S[f"SMA {n}"] = pd.DataFrame({t: full[t].rolling(n).mean() for t in raw}).reindex(idx)
    return S
LINES = sig_frames()
MOM = {m: pd.DataFrame({t: full[t] / full[t].shift(m) - 1 for t in raw}).reindex(idx) for m in (63, 126)}
SMA200 = LINES["SMA 200"]

def run(pool, slots, line, rank, mom_filter=None):
    cols = [t for t in pool if t in raw]
    o = O[cols].values; c = C[cols].values; L = LINES[line][cols].values
    M = MOM[int(rank[3:])][cols].values if rank else None
    base = (c / L - 1)                                  # 선 대비 위치
    hold = base > 0
    if mom_filter: hold = hold & (MOM[mom_filter][cols].values > 0) & (c > SMA200[cols].values)
    score = M if rank else base
    n = len(idx); cash = 1.0; q = np.zeros(len(cols)); eq = np.full(n, np.nan); trades = []; entry = np.zeros(len(cols))
    eq[0] = 1.0
    for k in range(n - 1):
        valid = ~np.isnan(L[k]) & ~np.isnan(c[k])
        if mom_filter or rank: valid &= ~np.isnan(score[k])
        # 청산
        for j in range(len(cols)):
            if q[j] > 0 and valid[j] and not hold[k, j] and not np.isnan(o[k + 1, j]):
                px = o[k + 1, j] * (1 - FEE); cash += q[j] * px; trades.append(px / entry[j] - 1); q[j] = 0
        # 진입 (복리: 슬롯 예산 = 총자산/슬롯수)
        total = cash + np.nansum(q * c[k])
        cand = [j for j in range(len(cols)) if valid[j] and hold[k, j] and q[j] == 0 and not np.isnan(o[k + 1, j])]
        cand.sort(key=lambda j: -score[k, j])
        for j in cand:
            if (q > 0).sum() >= slots: break
            bud = min(cash, total / slots)
            if bud < 1e-4: break
            px = o[k + 1, j] * (1 + FEE); q[j] = bud / px; entry[j] = px; cash -= bud
        eq[k + 1] = cash + np.nansum(np.where(np.isnan(c[k + 1]), q * entry, q * c[k + 1]))
    s = pd.Series(eq, index=idx).ffill()
    yrs = (s.index[-1] - s.index[0]).days / 365.25
    cagr = s.iloc[-1] ** (1 / yrs) - 1; mdd = (s / s.cummax() - 1).min()
    half = s.index[len(s) // 2]
    h1 = (s[:half].iloc[-1] / s.iloc[0]) ** (1 / ((half - s.index[0]).days / 365.25)) - 1
    h2 = (s.iloc[-1] / s[:half].iloc[-1]) ** (1 / ((s.index[-1] - half).days / 365.25)) - 1
    w = [x for x in trades if x > 0]
    return s, dict(cagr=round(cagr * 100, 1), mdd=round(mdd * 100, 1), total=round((s.iloc[-1] - 1) * 100), c1=round(h1 * 100, 1), c2=round(h2 * 100, 1),
                   n=len(trades), win=round(len(w) / max(1, len(trades)) * 100), calmar=round(cagr / abs(mdd), 2))

res = []; curves = {}
combos = []
for pn, pool in POOLS.items():
    for slots in ([1] if len(pool) == 1 else [2, 3, 5]):
        if slots > len(pool): continue
        for line in ["VIDYA 30", "VIDYA 60", "VIDYA 120", "VIDYA 200", "SMA 100", "SMA 200"]:
            combos.append((pn, pool, slots, line, None, None))
        combos.append((pn, pool, slots, "VIDYA 60", "mom126", None)); combos.append((pn, pool, slots, "SMA 200", "mom63", None))
for pn, pool, slots, line, rank, mf in combos:
    s, st = run(pool, slots, line, rank, mf)
    name = f"{pn} · {slots}종목 · {line}" + (f" · 6개월모멘텀순위" if rank == "mom126" else "") + (" · 3개월모멘텀순위" if rank == "mom63" else "")
    st.update(name=name, pool=pn, slots=slots, line=line, rank=rank); res.append(st); curves[name] = s
    print(f"{name:62s} 연 {st['cagr']:>5}% MDD {st['mdd']:>6}% 칼마 {st['calmar']:>5} | 전반 {st['c1']:>5}% 후반 {st['c2']:>5}% | 거래 {st['n']} 승률 {st['win']}%", flush=True)
# 기준선
sp = SPY["Close"].reindex(idx).ffill(); sp = sp / sp.iloc[0]
yrs = (sp.index[-1] - sp.index[0]).days / 365.25; print(f"SPY 연 {(sp.iloc[-1]**(1/yrs)-1)*100:.1f}% MDD {((sp/sp.cummax()-1).min())*100:.1f}%")
ew = (C.pct_change().mean(axis=1).fillna(0) + 1).cumprod()
print(f"12종 균등보유 연 {(ew.iloc[-1]**(1/yrs)-1)*100:.1f}% MDD {((ew/ew.cummax()-1).min())*100:.1f}%")
byc = sorted(res, key=lambda r: -r["cagr"]); bycal = sorted(res, key=lambda r: -r["calmar"])
print("\n수익률 TOP5:"); [print(" ", r["name"], r["cagr"], r["mdd"]) for r in byc[:5]]
print("칼마 TOP5:"); [print(" ", r["name"], r["cagr"], r["mdd"], r["calmar"]) for r in bycal[:5]]
def monthly(s): return [[str(d.date())[:7], round(float(v), 3)] for d, v in s.resample("ME").last().items()]
out = {"top_cagr": byc[:8], "top_calmar": bycal[:8], "all": res,
       "curve_best": {"name": byc[0]["name"], "m": monthly(curves[byc[0]["name"]])}, "curve_cal": {"name": bycal[0]["name"], "m": monthly(curves[bycal[0]["name"]])},
       "spy": monthly(sp), "ew": monthly(ew), "spy_stat": [round((sp.iloc[-1]**(1/yrs)-1)*100, 1), round(((sp/sp.cummax()-1).min())*100, 1)],
       "ew_stat": [round((ew.iloc[-1]**(1/yrs)-1)*100, 1), round(((ew/ew.cummax()-1).min())*100, 1)]}
print("JSON=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")))
