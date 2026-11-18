"""박스 아래끝 기준 비교: 거래량 큰 봉(최근 90봉 중 상위15%·중앙값1.4배↑, 저가≤볼밴하단)이 생긴 뒤
60거래일 안에 아래 가격에 '지정가 매수'했다면? (체결률·체결 뒤 60일 승률/평균/체결 뒤 추가 하락)
 A) 일봉 볼밴 하단(그 봉의 하단선)  B) 그 봉의 저가  C) 저가 × (1+이 종목 과거 추가하락 중앙값; 이 시점 이전 이벤트만)  D) 이벤트 다음날 종가(그냥 매수)"""
import re, numpy as np, yfinance as yf
src = open("gs/Picks.gs", encoding="utf-8").read()
SYMS = sorted(set(re.findall(r'"([A-Z][A-Z0-9.\-]{0,6})"', src[src.index("var PICK_GROUPS"):src.index("var PICK_UNIVERSE")])))
LEV = {"NVDL","TQQQ","SOXL","TSLL","BITX","ETHU","LABU","SQQQ","UVXY","TSLQ","NVDQ","FNGU","CONL","MSTU","BULZ","TECL","UPRO","SPXL","YINN","KORU","NUGT","JNUG","DPST","WEBL","HIBL","FAS","TNA","URTY","SOXS"}
res = {k: [] for k in "ABCD"}; nev = 0
for i in range(0, len(SYMS), 40):
    part = SYMS[i:i+40]
    try: df = yf.download(part, period="10y", interval="1d", auto_adjust=False, progress=False, group_by="ticker", threads=True)
    except Exception: continue
    for t in part:
        if t in LEV: continue
        try:
            x = df[t].dropna(subset=["Close", "Low", "Volume"]); c = x["Close"].to_numpy(); l = x["Low"].to_numpy(); v = x["Volume"].to_numpy().astype(float); n = len(c)
            if n < 600: continue
            ma = np.array([c[k-19:k+1].mean() if k >= 19 else np.nan for k in range(n)]); sd = np.array([c[k-19:k+1].std() if k >= 19 else np.nan for k in range(n)]); lo = ma - 2*sd
            drops = []; prev = False; lastb = -99; lastev = -99
            for k in range(90, n - 61):
                bl = lo[k] > 0 and c[k] < lo[k]
                if bl and not prev and k - lastb >= 10 and k + 60 < n:
                    lastb = k; drops.append((k + 60, min(0, l[k+1:k+61].min() / lo[k] - 1)))     # k+60 이후에 알 수 있는 값
                prev = bl
                W = v[k-89:k+1]; med = np.median(W); p85 = np.sort(W)[int(90*0.85)]
                if not (lo[k] > 0 and l[k] <= lo[k] and v[k] >= p85 and v[k] >= 1.4*med) or k - lastev < 20: continue
                # 최근 40봉 중 조건 만족 봉 중 거래량 최대가 이 봉일 때만(=기준 봉)
                lastev = k; known = [d for (kk, d) in drops if kk <= k]
                if len(known) < 3: continue
                dm = np.median(known); nev += 1
                lv = {"A": lo[k], "B": l[k], "C": l[k] * (1 + dm)}
                end = min(n - 1, k + 60)
                for name, L in lv.items():
                    hit = np.where(l[k+1:end+1] <= L)[0]
                    if len(hit): f = k + 1 + hit[0]; r = (c[min(n-1, f+60)] / L - 1, l[f:min(n-1, f+60)+1].min() / L - 1, True)
                    else: r = (0, 0, False)
                    res[name].append(r)
                res["D"].append((c[min(n-1, k+61)] / c[k+1] - 1, l[k+1:min(n-1, k+61)+1].min() / c[k+1] - 1, True))
        except Exception: pass
print("RES 이벤트", nev)
for name, lab in [("A", "일봉 볼밴 하단"), ("B", "봉의 저가"), ("C", "저가×(1+과거 추가하락 중앙값)"), ("D", "다음날 종가(그냥 매수)")]:
    a = res[name]; f = [r for r in a if r[2]]
    if not f: continue
    rr = np.array([r[0] for r in f]); dd = np.array([r[1] for r in f])
    print("RES %-24s 체결 %2.0f%% | 체결 뒤 60일 승률 %2.0f%% 평균 %+5.1f%% 중앙 %+5.1f%% | 체결 뒤 추가하락 중앙 %+5.1f%% (-10%%이상 %2.0f%%) | 전체 이벤트 기대수익 %+5.2f%%" % (lab, 100*len(f)/len(a), 100*(rr > 0).mean(), 100*rr.mean(), 100*np.median(rr), 100*np.median(dd), 100*(dd <= -.10).mean(), 100*rr.sum()/len(a)))
