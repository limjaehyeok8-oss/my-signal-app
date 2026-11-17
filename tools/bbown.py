"""종목 '자기 자신'의 과거 이탈 깊이를 기준으로 본 통계.
각 종목마다: 과거에 주봉 볼린저(20,2) 하단을 이탈한 주들의 괴리율 분포를 모으고(미래 정보 없이, 그 시점까지만),
지금 괴리율이 '자기 과거 이탈 중 상위 몇 % 깊이'인지(깊이 백분위)에 따라 이후 8주 성적을 본다."""
import re, numpy as np, yfinance as yf

src = open("gs/Picks.gs", encoding="utf-8").read()
SYMS = sorted(set(re.findall(r'"([A-Z][A-Z0-9.\-]{0,6})"', src[src.index("var PICK_GROUPS"):src.index("var PICK_UNIVERSE")])))
LEV = {"NVDL","TQQQ","SOXL","TSLL","BITX","ETHU","LABU","SQQQ","UVXY","TSLQ","NVDQ","FNGU","CONL","MSTU","BULZ","TECL","UPRO","SPXL","YINN","KORU","NUGT","JNUG","DPST","WEBL","HIBL","FAS","TNA","URTY","SOXS"}
MINPAST = 12
rows = []   # sym, gap, pct(깊이백분위), f8, f4, nofurther(8주내 추가 -3%초과 하락 없음), pastMed
prof = {}   # 종목별 전체 요약

def calc(sym, c):
    n = len(c)
    if n < 100: return
    gaps = np.full(n, np.nan)
    for k in range(19, n):
        w = c[k-19:k+1]; sd = w.std()
        if sd > 0 and c[k] >= 3: gaps[k] = (c[k] / (w.mean() - 2*sd) - 1) * 100
    past = []
    for k in range(19, n):
        g = gaps[k]
        if np.isnan(g): continue
        if g < 0:
            past.append(-g)
            if len(past) > MINPAST and k + 8 < n:
                pct = (np.array(past) <= -g).mean() * 100      # 자기 과거 이탈 중 이만큼 깊거나 덜 깊었던 비율
                f8 = (c[k+8] / c[k] - 1) * 100
                f4 = (c[k+4] / c[k] - 1) * 100
                dd = (c[k+1:k+9].min() / c[k] - 1) * 100
                rows.append((sym, g, pct, f8, f4, dd, np.median(past)))
    allp = [-x for x in gaps if not np.isnan(x) and x < 0]
    if len(allp) >= 8:
        a = np.array([-x for x in allp])
        prof[sym] = (len(a), np.median(a), np.percentile(a, 75), np.percentile(a, 90), a.max(), gaps[-1])

for i in range(0, len(SYMS), 40):
    part = SYMS[i:i+40]
    try: df = yf.download(part, period="10y", interval="1wk", auto_adjust=True, progress=False, group_by="ticker", threads=True)
    except Exception as e: print("ERR", e); continue
    for t in part:
        if t in LEV: continue
        try: calc(t, df[t]["Close"].dropna().to_numpy(float))
        except Exception: pass

A = np.array([r[1:] for r in rows]); S = np.array([r[0] for r in rows])
gap, pct, f8, f4, dd, pmed = A.T
print("RES 종목 %d개, 이탈주 관측 %d개 (종목별 과거 %d회 이상 쌓인 뒤부터)" % (len(set(S)), len(A), MINPAST))
print("RES 이탈 전체 8주 평균 %+.1f%% 승률 %.0f%%" % (f8.mean(), 100*(f8>0).mean()))
print("RES === 자기 과거 이탈 깊이 백분위별 (낮음=평소 이탈보다 얕음, 높음=평소보다 깊음)")
def st(m, label):
    if m.sum() < 30: print("RES %-24s 관측 %4d (적음)" % (label, m.sum())); return
    x = f8[m]
    print("RES %-24s 관측 %5d 종목 %3d | 평균괴리 %5.1f%% | 4주 %+5.1f%% | 8주 평균 %+5.1f%% 중앙 %+5.1f%% 승률 %3.0f%% 하위10%% %+6.1f%% | 8주내 최저 평균 %+5.1f%%" % (
        label, m.sum(), len(set(S[m])), gap[m].mean(), f4[m].mean(), x.mean(), np.median(x), 100*(x>0).mean(), np.percentile(x,10), dd[m].mean()))
for a, b in [(0,25),(25,50),(50,75),(75,90),(90,99.99),(99.99,101)]:
    st((pct>=a)&(pct<b), "깊이 상위 %d~%d%%" % (100-b if b<100 else 0, 100-a))
print("RES === 같은 종목 중앙 이탈깊이 대비 배수 (현재 괴리 / 그 종목 과거 중앙값)")
r = gap / pmed
for a, b in [(0,0.5),(0.5,1),(1,1.5),(1.5,2),(2,3),(3,99)]: st((r>=a)&(r<b), "배수 %.1f~%.1f" % (a, b))
print("RES === 비교: 모든 종목 같은 고정 % 기준")
for hi, lo in [(0,-3),(-3,-7),(-7,-15),(-15,-100)]: st((-gap<=-lo)&(-gap>-hi) if False else ((gap>=-hi)&(gap<-lo)) if False else ((gap>=lo)&(gap<hi)), "고정 %d~%d%%" % (hi, lo)) if False else None
for hi, lo in [(3,7),(7,15),(15,100)]:
    st((gap>=lo)&(gap<hi), "고정 -%d~-%d%%" % (lo, hi))
print("RES === 종목별 이탈 깊이 프로필 (과거 이탈 주 수 / 중앙 / 상위25% / 상위10% / 역대최대 / 현재괴리)")
for s in ["NVDA","AAPL","MSFT","TSLA","XOM","AMZN","META","GOOGL","AMD","JPM","KO","PLTR","COIN","SPY","QQQ"]:
    if s in prof:
        n, m, p75, p90, mx, cur = prof[s]
        print("RES %-6s %3d회 | 중앙 -%4.1f%% | 75%% -%4.1f%% | 90%% -%4.1f%% | 최대 -%4.1f%% | 지금 %+5.1f%%" % (s, n, m, p75, p90, mx, cur))
med = np.array([v[1] for v in prof.values()])
print("RES 종목별 '중앙 이탈깊이' 분포: 최소 %.1f%% / 25%% %.1f%% / 중앙 %.1f%% / 75%% %.1f%% / 최대 %.1f%%" % (med.min(), *np.percentile(med,[25,50,75]), med.max()))
