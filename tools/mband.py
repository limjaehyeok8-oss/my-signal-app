"""월봉 볼밴 하단 근처에서 샀을 때: 그 아래로 얼마나 더 빠졌나 / 이후 성적.
월봉 하단 = 직전까지 '끝난' 달의 종가로 계산(20개월, 2σ). 일봉 저가가 이 선에 닿은 날을 이벤트로(20거래일 간격)."""
import re, numpy as np, pandas as pd, yfinance as yf
src = open("gs/Picks.gs", encoding="utf-8").read()
SYMS = sorted(set(re.findall(r'"([A-Z][A-Z0-9.\-]{0,6})"', src[src.index("var PICK_GROUPS"):src.index("var PICK_UNIVERSE")])))
LEV = {"NVDL","TQQQ","SOXL","TSLL","BITX","ETHU","LABU","SQQQ","UVXY","TSLQ","NVDQ","FNGU","CONL","MSTU","BULZ","TECL","UPRO","SPXL","YINN","KORU","NUGT","JNUG","DPST","WEBL","HIBL","FAS","TNA","URTY","SOXS"}
rows = []
for i in range(0, len(SYMS), 40):
    part = SYMS[i:i+40]
    try: df = yf.download(part, period="max", interval="1d", auto_adjust=False, progress=False, group_by="ticker", threads=True)
    except Exception: continue
    for t in part:
        if t in LEV: continue
        try:
            x = df[t].dropna(subset=["Close", "Low"]).copy()
            if len(x) < 800: continue
            mc = x["Close"].resample("ME").last()
            lo = (mc.rolling(20).mean() - 2 * mc.rolling(20).std(ddof=0))
            # 각 날짜에 적용: 직전 달 말까지의 하단 (현재 달 제외)
            per = x.index.to_period("M")
            lomap = pd.Series(lo.values, index=lo.index.to_period("M")).shift(1)
            x["mlo"] = lomap.reindex(per).values
            L = x["Low"].to_numpy(); C = x["Close"].to_numpy(); M = x["mlo"].to_numpy(); n = len(x); last = -99
            for k in range(0, n - 60):
                if not (M[k] > 0) or k - last < 20: continue
                if L[k] <= M[k]:
                    last = k; b = M[k]
                    r = {"sym": t, "touchclose": C[k] / b - 1}
                    for h in (60, 120):
                        if k + h < n:
                            r["ret%d" % h] = C[k+h] / C[k] - 1
                            r["min%d" % h] = L[k+1:k+h+1].min() / b - 1      # 이후 최저가가 월봉 하단 대비 몇 %?
                    rows.append(r)
        except Exception: pass
d = pd.DataFrame(rows); print("RES 이벤트", len(d), "종목", d.sym.nunique())
for h in (60, 120):
    s = d.dropna(subset=["ret%d" % h]); m = s["min%d" % h]
    print("RES [%d일] %d건 | 평균 %+5.1f%% 승률 %2.0f%% | 이후 최저가가 월봉하단 대비 중앙 %+5.1f%% / 하단 아래 -5%%이상 %2.0f%% -10%%이상 %2.0f%% -20%%이상 %2.0f%% -30%%이상 %2.0f%%" % (
        h, len(s), 100*s["ret%d"%h].mean(), 100*(s["ret%d"%h] > 0).mean(), 100*m.median(), 100*(m <= -.05).mean(), 100*(m <= -.10).mean(), 100*(m <= -.20).mean(), 100*(m <= -.30).mean()))
    print("RES   p25 %+5.1f%% p10 %+5.1f%% (최저가/월봉하단-1)" % (100*m.quantile(.25), 100*m.quantile(.10)))
s = d.dropna(subset=["ret60"]); 
for lab, f in [("터치한 날 종가가 하단 위(닿고 회복)", s.touchclose > 0), ("종가도 하단 아래", s.touchclose <= 0)]:
    q = s[f]
    if len(q) > 20: print("RES %-28s %d건 | 60일 평균 %+5.1f%% 승률 %2.0f%% | 최저가 중앙 %+5.1f%% -10%%이하 %2.0f%%" % (lab, len(q), 100*q.ret60.mean(), 100*(q.ret60 > 0).mean(), 100*q.min60.median(), 100*(q.min60 <= -.10).mean()))
