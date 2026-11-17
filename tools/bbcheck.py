"""볼린저(20, 2) 하단 이탈 확인: 서버(Picks.gs)와 같은 방식(종가 기준, 현재 봉 포함)으로 NVDA 등을 계산해서 보여줌."""
import yfinance as yf, numpy as np

def bands(c):
    w = c[-20:]; m = w.mean(); sd = w.std()      # 모표준편차
    return m - 2 * sd, m, m + 2 * sd

def show(t):
    for kind, kw in (("일봉", dict(period="1y", interval="1d")), ("주봉", dict(period="5y", interval="1wk"))):
        d = yf.Ticker(t).history(auto_adjust=True, **kw).dropna()
        c = d["Close"].to_numpy(float); lo_ = d["Low"].to_numpy(float)
        lower, ma, up = bands(c)
        gap = (c[-1] / lower - 1) * 100; wick = (lo_[-1] / lower - 1) * 100
        print("CHECK %-5s %s 마지막봉 %s 종가 %.2f 저가 %.2f | 하단 %.2f 20선 %.2f 상단 %.2f | 종가 괴리율 %+.1f%% 저가 괴리율 %+.1f%% -> %s" % (
            t, kind, d.index[-1].date(), c[-1], lo_[-1], lower, ma, up, gap, wick,
            "이탈(종가)" if gap < 0 else ("꼬리만 닿음" if wick < 0 else "밴드 안")))

for t in ["NVDA", "AMD", "AAPL", "MSFT"]:
    try: show(t)
    except Exception as e: print("CHECK", t, "ERR", e)

# 추천 종목 전체에서 몇 개가 이탈인지
import re
src = open("gs/Picks.gs", encoding="utf-8").read()
syms = sorted(set(re.findall(r'"([A-Z][A-Z0-9.\-]{0,6})"', src[src.index("var PICK_GROUPS"):src.index("var PICK_UNIVERSE")])))
print("CHECK 대상 종목 수", len(syms))
cnt = {"d": 0, "w": 0, "dwick": 0, "wwick": 0, "n": 0}
hit = {"d": [], "w": []}
for i in range(0, len(syms), 40):
    part = syms[i:i + 40]
    for kind, kw in (("d", dict(period="1y", interval="1d")), ("w", dict(period="5y", interval="1wk"))):
        try:
            df = yf.download(part, auto_adjust=True, progress=False, group_by="ticker", threads=True, **kw)
        except Exception as e:
            print("CHECK dl ERR", e); continue
        for t in part:
            try:
                x = df[t].dropna(); c = x["Close"].to_numpy(float)
                if len(c) < 20 or c[-1] < 3: continue
                lower = bands(c)[0]
                if c[-1] < lower: cnt[kind] += 1; hit[kind].append((t, round((c[-1] / lower - 1) * 100, 1)))
                elif x["Low"].to_numpy(float)[-1] < lower: cnt[kind + "wick"] += 1
                if kind == "d": cnt["n"] += 1
            except Exception: pass
print("CHECK 일봉 종가 이탈 %d개, 일봉 꼬리만 %d개, 주봉 종가 이탈 %d개, 주봉 꼬리만 %d개 (일봉 계산 %d종목)" % (cnt["d"], cnt["dwick"], cnt["w"], cnt["wwick"], cnt["n"]))
print("CHECK 주봉 이탈:", sorted(hit["w"], key=lambda z: z[1])[:15])
print("CHECK 일봉 이탈:", sorted(hit["d"], key=lambda z: z[1])[:15])
