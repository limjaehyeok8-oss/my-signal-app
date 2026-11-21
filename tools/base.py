"""장기 바닥 다지기(오래 횡보) 후보가 실제로 이후 성적이 좋았나. 주봉 기준.
공통: 최근 3년 고점 대비 -40% 이하(크게 빠졌던 종목)
 횡보: 최근 26주 고저폭(고가/저가-1) <= 45% 이고 30주 이동평균이 13주간 ±5% 이내
 매집 흔적: 최근 26주 상승주 거래량 합 / 하락주 거래량 합 >= 1.1
 거래량 마름: 최근 8주 평균 거래량 <= 52주 평균 x 0.9
 돌파: 이번 주 종가가 직전 26주 최고 고가를 넘음
이후 26주·52주 수익률과 그 사이 최저가(추가 하락)를 비교. 같은 종목 신호는 13주 간격으로 솎음."""
import re, numpy as np, yfinance as yf
src = open("gs/Picks.gs", encoding="utf-8").read()
SYMS = sorted(set(re.findall(r'"([A-Z][A-Z0-9.\-]{0,6})"', src[src.index("var PICK_GROUPS"):src.index("var PICK_UNIVERSE")])))
LEV = {"NVDL","TQQQ","SOXL","TSLL","BITX","ETHU","LABU","SQQQ","UVXY","TSLQ","NVDQ","FNGU","CONL","MSTU","BULZ","TECL","UPRO","SPXL","YINN","KORU","NUGT","JNUG","DPST","WEBL","HIBL","FAS","TNA","URTY","SOXS"}
G = ["전체(기준)", "-40%이상 빠졌던 종목(기준)", "+횡보", "+횡보+매집흔적", "+횡보+매집+거래량마름", "+횡보+돌파", "+횡보+매집+돌파"]
R = {g: [] for g in G}; last = {g: {} for g in G}
for i in range(0, len(SYMS), 40):
    part = SYMS[i:i+40]
    try: df = yf.download(part, period="max", interval="1wk", auto_adjust=False, progress=False, group_by="ticker", threads=True)
    except Exception: continue
    for t in part:
        if t in LEV: continue
        try:
            x = df[t].dropna(subset=["Close", "High", "Low", "Volume"]).iloc[:-1]; c = x["Close"].to_numpy(); h = x["High"].to_numpy(); l = x["Low"].to_numpy(); v = x["Volume"].to_numpy().astype(float); o = x["Open"].to_numpy(); n = len(c)
            if n < 260: continue
            ma30 = np.array([c[k-29:k+1].mean() if k >= 29 else np.nan for k in range(n)])
            for k in range(160, n - 52):
                dd = c[k] / c[k-156:k+1].max() - 1
                rng = h[k-25:k+1].max() / l[k-25:k+1].min() - 1
                side = rng <= 0.45 and abs(ma30[k] / ma30[k-13] - 1) <= 0.05
                up = v[k-25:k+1][c[k-25:k+1] >= o[k-25:k+1]].sum(); dn = v[k-25:k+1][c[k-25:k+1] < o[k-25:k+1]].sum()
                acc = dn > 0 and up / dn >= 1.1
                dry = v[k-7:k+1].mean() <= 0.9 * v[k-51:k+1].mean()
                brk = c[k] > h[k-26:k].max()
                flags = {"전체(기준)": True, "-40%이상 빠졌던 종목(기준)": dd <= -0.40}
                big = dd <= -0.40
                flags["+횡보"] = big and side; flags["+횡보+매집흔적"] = big and side and acc; flags["+횡보+매집+거래량마름"] = big and side and acc and dry
                flags["+횡보+돌파"] = big and side and brk; flags["+횡보+매집+돌파"] = big and side and acc and brk
                for g, ok in flags.items():
                    if ok and k - last[g].get(t, -99) >= 13:
                        last[g][t] = k; R[g].append((c[k+26] / c[k] - 1, c[k+52] / c[k] - 1, l[k+1:k+53].min() / c[k] - 1, t))
        except Exception as ex: print("RES 오류", t, repr(ex))
for g in G:
    a = R[g]
    if len(a) < 10: print("RES %-24s 건수 %d (적음)" % (g, len(a))); continue
    r26 = np.array([r[0] for r in a]); r52 = np.array([r[1] for r in a]); dd = np.array([r[2] for r in a])
    print("RES %-24s %6d건 종목 %3d | 26주 승률 %2.0f%% 평균 %+5.1f%% 중앙 %+5.1f%% | 52주 승률 %2.0f%% 평균 %+5.1f%% 중앙 %+5.1f%% | 이후 최저가 중앙 %+5.1f%% (-20%%이상 %2.0f%%)" % (
        g, len(a), len(set(r[3] for r in a)), 100*(r26 > 0).mean(), 100*r26.mean(), 100*np.median(r26), 100*(r52 > 0).mean(), 100*r52.mean(), 100*np.median(r52), 100*np.median(dd), 100*(dd <= -.2).mean()))
