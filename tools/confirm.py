"""'종가가 전 캔들 고점을 넘어야 반전' 검증.
이벤트 = (A) 볼밴 하단 이탈(종가<하단) 첫날  (B) 거래량 큰 봉이 하단을 건드린 날(상위15%·중앙값1.4배↑·저가≤하단).
비교: 즉시 매수(이벤트 다음날 종가) vs 이벤트 뒤 20거래일 안에 '종가>전 캔들 고점'이 처음 나온 날 종가에 매수 (그 전에 못 나오면 미체결)
추가 변형: 확인 + 그날 종가가 이벤트 이후 최저가 위(항상 참)·'종가>전 캔들 고점 and 양봉'.  결과: 60일 뒤 수익, 승률, 매수 뒤 추가 하락, 이벤트 기준 기대수익(미체결=0)"""
import re, numpy as np, yfinance as yf
src = open("gs/Picks.gs", encoding="utf-8").read()
SYMS = sorted(set(re.findall(r'"([A-Z][A-Z0-9.\-]{0,6})"', src[src.index("var PICK_GROUPS"):src.index("var PICK_UNIVERSE")])))
LEV = {"NVDL","TQQQ","SOXL","TSLL","BITX","ETHU","LABU","SQQQ","UVXY","TSLQ","NVDQ","FNGU","CONL","MSTU","BULZ","TECL","UPRO","SPXL","YINN","KORU","NUGT","JNUG","DPST","WEBL","HIBL","FAS","TNA","URTY","SOXS"}
R = {e: {m: [] for m in ("즉시", "확인(종가>전고점)", "확인+양봉", "확인 못함(20일내)")} for e in "AB"}
for i in range(0, len(SYMS), 40):
    part = SYMS[i:i+40]
    try: df = yf.download(part, period="10y", interval="1d", auto_adjust=False, progress=False, group_by="ticker", threads=True)
    except Exception: continue
    for t in part:
        if t in LEV: continue
        try:
            x = df[t].dropna(subset=["Close", "Low", "High", "Open", "Volume"]); c = x["Close"].to_numpy(); l = x["Low"].to_numpy(); h = x["High"].to_numpy(); o = x["Open"].to_numpy(); v = x["Volume"].to_numpy().astype(float); n = len(c)
            if n < 600: continue
            ma = np.array([c[k-19:k+1].mean() if k >= 19 else np.nan for k in range(n)]); sd = np.array([c[k-19:k+1].std() if k >= 19 else np.nan for k in range(n)]); lo = ma - 2*sd
            prev = False; lastA = -99; lastB = -99
            for k in range(90, n - 90):
                bl = lo[k] > 0 and c[k] < lo[k]
                evs = []
                if bl and not prev and k - lastA >= 10: evs.append("A"); lastA = k
                prev = bl
                W = v[k-89:k+1]
                if lo[k] > 0 and l[k] <= lo[k] and v[k] >= np.sort(W)[int(90*.85)] and v[k] >= 1.4*np.median(W) and k - lastB >= 20: evs.append("B"); lastB = k
                for e in evs:
                    def res(j):                                   # j일에 종가 매수 → 60일 뒤 수익, 이후 최저가
                        return (c[j+60] / c[j] - 1, l[j+1:j+61].min() / c[j] - 1)
                    R[e]["즉시"].append(res(k + 1))
                    f1 = f2 = None
                    for j in range(k + 1, k + 21):
                        if c[j] > h[j-1]:
                            if f1 is None: f1 = j
                            if f2 is None and c[j] > o[j]: f2 = j
                    if f1 is not None and f1 + 60 < n: R[e]["확인(종가>전고점)"].append(res(f1))
                    else: R[e]["확인 못함(20일내)"].append(None)
                    if f2 is not None and f2 + 60 < n: R[e]["확인+양봉"].append(res(f2))
        except Exception: pass
for e, lab in [("A", "볼밴 하단 이탈 첫날"), ("B", "거래량 큰 봉이 하단 터치")]:
    N = len(R[e]["즉시"]); print("RES ===== %s: 이벤트 %d건" % (lab, N))
    for m in ("즉시", "확인(종가>전고점)", "확인+양봉"):
        a = np.array(R[e][m]); 
        if len(a) == 0: continue
        print("RES  %-18s 매수 %5d건(%2.0f%%) | 60일 승률 %2.0f%% 평균 %+5.1f%% 중앙 %+5.1f%% | 매수 뒤 추가하락 중앙 %+5.1f%% (-10%%이상 %2.0f%%) | 이벤트 기준 기대수익 %+5.2f%%" % (m, len(a), 100*len(a)/N, 100*(a[:,0] > 0).mean(), 100*a[:,0].mean(), 100*np.median(a[:,0]), 100*np.median(a[:,1]), 100*(a[:,1] <= -.10).mean(), 100*a[:,0].sum()/N))
