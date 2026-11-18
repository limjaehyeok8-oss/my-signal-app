"""책의 주장(주요 저점의 셀링 클라이맥스) 쪽 조건으로 재검증.
1) 일봉 클라이맥스의 '저점 유지'(60일 안에 그날 저가를 다시 깼는지)
2) 주봉 클라이맥스 (13·26주 뒤 성적, 저점 유지)
3) 월봉 클라이맥스
4) 시장 전체(SPY) 투매일: 이후 20·60·120일 성적과 저점 유지"""
import re, numpy as np, pandas as pd, yfinance as yf

src = open("gs/Picks.gs", encoding="utf-8").read()
SYMS = sorted(set(re.findall(r'"([A-Z][A-Z0-9.\-]{0,6})"', src[src.index("var PICK_GROUPS"):src.index("var PICK_UNIVERSE")])))
LEV = {"NVDL","TQQQ","SOXL","TSLL","BITX","ETHU","LABU","SQQQ","UVXY","TSLQ","NVDQ","FNGU","CONL","MSTU","BULZ","TECL","UPRO","SPXL","YINN","KORU","NUGT","JNUG","DPST","WEBL","HIBL","FAS","TNA","URTY","SOXS"}

def feats(df):
    df = df.dropna(subset=["Close", "High", "Low", "Volume"]).copy()
    c = df["Close"]; ma = c.rolling(20).mean(); sd = c.rolling(20).std(ddof=0)
    df["lo"] = ma - 2 * sd
    df["vr"] = df["Volume"] / df["Volume"].rolling(20).mean().shift(1)
    df["pos"] = (c - df["Low"]) / (df["High"] - df["Low"]).replace(0, np.nan)
    return df

def events(df, ctxfun, gap, hs):
    """ctxfun(df)->bool Series. 반환: 각 이벤트의 (vr,pos,{h:수익률},{h:저점유지})"""
    c, l = df["Close"].to_numpy(), df["Low"].to_numpy(); n = len(df); ctx = ctxfun(df).to_numpy(); out = []; last = -99
    for i in range(25, n):
        if not ctx[i] or i - last < gap: continue
        last = i
        r = {}; held = {}
        for h in hs:
            if i + h < n:
                r[h] = c[i+h] / c[i] - 1
                held[h] = bool(l[i+1:i+h+1].min() >= l[i])        # 그날(주) 저가를 h봉 동안 안 깼는가
        out.append((df["vr"].iloc[i], df["pos"].iloc[i], r, held))
    return out

def show(label, ev, hs, minn=20):
    if len(ev) < minn: print("RES %-36s 건수 %5d (적음)" % (label, len(ev))); return
    s = "RES %-36s 건수 %5d" % (label, len(ev))
    for h in hs:
        rs = [e[2][h] for e in ev if h in e[2]]; hd = [e[3][h] for e in ev if h in e[3]]
        if rs: s += " | %d봉 %+5.1f%% 승률 %2.0f%% 저점유지 %2.0f%%" % (h, 100*np.mean(rs), 100*np.mean(np.array(rs) > 0), 100*np.mean(hd))
    print(s)

D, W, M = [], [], []
for i in range(0, len(SYMS), 40):
    part = SYMS[i:i+40]
    for iv, store, gap, hs in [("1d", D, 10, [20, 60]), ("1wk", W, 8, [13, 26]), ("1mo", M, 3, [6, 12])]:
        try: df = yf.download(part, period="10y", interval=iv, auto_adjust=False, progress=False, group_by="ticker", threads=True)
        except Exception as e: continue
        for t in part:
            if t in LEV: continue
            try:
                x = feats(df[t])
                if iv != "1d": x = x.iloc[:-1]                      # 마지막(진행 중) 봉 제외
                if len(x) > 40: store.append((t, x, gap, hs))
            except Exception: pass

def gather(S, ctxfun):
    allev = []
    for t, x, gap, hs in S: allev += events(x, ctxfun, gap, hs)
    return allev, S[0][3]
ctx_d = lambda x: (x["Close"] < x["lo"]) & (x["lo"] > 0)
print("RES ===== 1) 일봉: 볼밴 하단 이탈일 중 / 60일 안에 그날 저가 유지")
ev, hs = gather(D, ctx_d)
show("전체(기준)", ev, hs); show("거래량 폭증(2.5배+)", [e for e in ev if e[0] >= 2.5], hs); show("폭증 + 위쪽 마감", [e for e in ev if e[0] >= 2.5 and e[1] >= 0.67], hs)
show("거래량 3.5배+ 위쪽 마감", [e for e in ev if e[0] >= 3.5 and e[1] >= 0.67], hs)
print("RES ===== 2) 주봉: 하단 이탈 주 중")
ev, hs = gather(W, ctx_d)
show("전체(기준)", ev, hs); show("거래량 폭증(2배+)", [e for e in ev if e[0] >= 2], hs); show("폭증(2배+) + 위쪽 마감", [e for e in ev if e[0] >= 2 and e[1] >= 0.5], hs)
show("거래량 3배+", [e for e in ev if e[0] >= 3], hs, 10); show("거래량 3배+ + 위쪽 마감", [e for e in ev if e[0] >= 3 and e[1] >= 0.5], hs, 10)
print("RES ===== 2b) 주봉: 8주 전 대비 -25% 이상 급락 + ")
ctx_w2 = lambda x: (x["Close"] / x["Close"].shift(8) - 1) <= -0.25
ev, hs = gather(W, ctx_w2)
show("급락 전체(기준)", ev, hs); show("급락 + 거래량 폭증(2배+)", [e for e in ev if e[0] >= 2], hs); show("급락 + 폭증 + 위쪽 마감", [e for e in ev if e[0] >= 2 and e[1] >= 0.5], hs, 10)
print("RES ===== 3) 월봉: 하단 이탈 달 중")
ev, hs = gather(M, ctx_d)
show("전체(기준)", ev, hs); show("거래량 폭증(2배+)", [e for e in ev if e[0] >= 2], hs, 10); show("폭증 + 위쪽 마감", [e for e in ev if e[0] >= 2 and e[1] >= 0.5], hs, 5)

print("RES ===== 4) 시장 전체(SPY, 1993~) 투매일: 거래량 1.8배 이상 & 볼밴 하단 이탈 & 5일 -5% 이하")
s = yf.download("SPY", period="max", interval="1d", auto_adjust=False, progress=False)
s.columns = [c[0] if isinstance(c, tuple) else c for c in s.columns]; s = feats(s)
s["r5"] = s["Close"].pct_change(5)
cc, ll = s["Close"].to_numpy(), s["Low"].to_numpy(); last = -99; rows = []
for i in range(25, len(s) - 1):
    if (s["Close"].iloc[i] < s["lo"].iloc[i]) and s["vr"].iloc[i] >= 1.8 and s["r5"].iloc[i] <= -0.05 and i - last >= 20:
        last = i; r = {}
        for h in (20, 60, 120):
            if i + h < len(s): r[h] = (cc[i+h] / cc[i] - 1, bool(ll[i+1:i+h+1].min() >= ll[i]))
        rows.append((s.index[i].strftime("%Y-%m-%d"), s["vr"].iloc[i], s["pos"].iloc[i], r))
for d, vr, pos, r in rows:
    print("RES %s 거래량 %.1f배 종가위치 %.2f | " % (d, vr, pos) + " ".join("%d일 %+5.1f%%%s" % (h, 100*r[h][0], "(저점유지)" if r[h][1] else "(저점이탈)") for h in (20, 60, 120) if h in r))
for h in (20, 60, 120):
    a = [r[h] for _, _, _, r in rows if h in r]
    if a: print("RES 시장 투매일 %d건 | %d일 뒤 평균 %+5.1f%% 승률 %2.0f%% 저점유지 %2.0f%%" % (len(a), h, 100*np.mean([x[0] for x in a]), 100*np.mean([x[0] > 0 for x in a]), 100*np.mean([x[1] for x in a])))
