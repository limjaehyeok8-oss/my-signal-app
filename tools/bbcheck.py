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
store = {}
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
                lower = bands(c)[0]; store[(kind, t)] = c
                if c[-1] < lower: cnt[kind] += 1; hit[kind].append((t, round((c[-1] / lower - 1) * 100, 1)))
                elif x["Low"].to_numpy(float)[-1] < lower: cnt[kind + "wick"] += 1
                if kind == "d": cnt["n"] += 1
            except Exception: pass
print("CHECK 일봉 종가 이탈 %d개, 일봉 꼬리만 %d개, 주봉 종가 이탈 %d개, 주봉 꼬리만 %d개 (일봉 계산 %d종목)" % (cnt["d"], cnt["dwick"], cnt["w"], cnt["wwick"], cnt["n"]))
print("CHECK 주봉 이탈:", sorted(hit["w"], key=lambda z: z[1])[:15])
print("CHECK 일봉 이탈:", sorted(hit["d"], key=lambda z: z[1])[:15])


# ---- 이탈 뒤 성적 점수 (Picks.gs 의 _bbStats 와 같은 계산) ----
def stats(c, hs, primary):
    n = len(c)
    if n < 25: return None
    lo = [None] * n
    for k in range(19, n):
        w = c[k - 19:k + 1]; lo[k] = w.mean() - 2 * w.std()
    ev, prev = [], False
    for k in range(n):
        below = lo[k] is not None and c[k] < lo[k]
        if below and not prev: ev.append(k)
        prev = below
    out = {}
    for h in hs:
        rs = [(c[e + h] / c[e] - 1) * 100 for e in ev if e + h < n]
        if rs: out[h] = (len(rs), np.mean(rs), 100 * np.mean([r > 0 for r in rs]), min(rs))
    pr = out.get(primary)
    sc = pr[1] * pr[0] / (pr[0] + 3) if pr else None
    return out, sc

for kind, hs, pm, nm in (("w", [2, 4, 8], 8, "주봉"), ("d", [5, 10, 20], 20, "일봉")):
    rows = []
    for t, g in hit[kind]:
        r = stats(store[(kind, t)], hs, pm)
        if r and r[1] is not None:
            o = r[0][pm]; rows.append((round(r[1], 1), t, g, o[0], round(o[1], 1), round(o[2]), round(o[3], 1)))
    rows.sort(reverse=True)
    print("CHECK %s 성적순 (점수, 종목, 괴리율, 횟수, 평균, 승률, 최악): 계산된 %d / 이탈 %d" % (nm, len(rows), len(hit[kind])))
    for r in rows[:12]: print("CHECK  ", r)
    print("CHECK  ...꼴찌", rows[-3:])
    if kind == "w":
        for t in ("NVDA",):
            r = stats(store[("w", t)], hs, pm)
            print("CHECK NVDA 주봉 이탈 뒤:", r)
