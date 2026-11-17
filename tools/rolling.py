"""1년 롤링 백테스트: 같은 전략을 시작일만 한 달씩 밀어 가며 1년 창으로 반복 → 수익률 분포.
(한 구간 5년은 시작이 저점이었느냐에 좌우되므로, 모든 시작 시점에서 얼마나 일관되게 이기는지를 본다)
체결: 신호 다음 날 시가, 비용 매수·매도 각 0.1%. 창 252거래일, 이동 21거래일."""
import yfinance as yf, numpy as np, pandas as pd

TICKERS = ("AAPL MSFT NVDA GOOGL AMZN META TSLA AVGO AMD NFLX JPM V MA XOM CVX JNJ LLY ABBV PG KO PEP COST WMT HD "
           "BAC DIS INTC CSCO ORCL CRM ADBE QCOM MU PLTR COIN UBER BA CAT GE NKE "
           "SPY QQQ IWM SOXX TQQQ SOXL TSLL NVDL").split()
FEE = 0.001

def ha_green(o, h, l, c):
    n = len(c); hc = (o + h + l + c) / 4; ho = np.empty(n); ho[0] = (o[0] + c[0]) / 2
    for i in range(1, n): ho[i] = (ho[i - 1] + hc[i - 1]) / 2
    return hc > ho

def sma(c, p):
    out = np.full(len(c), np.nan); cs = np.cumsum(c)
    if len(c) >= p: out[p - 1:] = (cs[p - 1:] - np.concatenate(([0], cs[:-p]))) / p
    return out

def simulate(o, c, ent, ex, lo, hi):
    """lo..hi 구간만 평가. 반환: 수익률%, MDD%, 참여%, 거래수"""
    hold = False; pend = None; eq = 1.0; peak = 1.0; mdd = 0.0; days = 0; trades = 0; prev = None
    for k in range(lo, hi):
        if pend == "buy": hold = True; eq *= (1 - FEE); prev = o[k]; pend = None
        elif pend == "sell": eq *= o[k] / prev * (1 - FEE); hold = False; trades += 1; pend = None
        if hold: eq *= c[k] / prev; prev = c[k]; days += 1
        peak = max(peak, eq); mdd = max(mdd, 1 - eq / peak)
        if not hold and ent[k]: pend = "buy"
        elif hold and ex[k]: pend = "sell"
    return (eq - 1) * 100, mdd * 100, days / max(hi - lo, 1) * 100, trades

def build(d):
    o, h, l, c = (d[x].to_numpy(dtype=float) for x in ("Open", "High", "Low", "Close"))
    n = len(c); g = ha_green(o, h, l, c); pg = np.concatenate(([False], g[:-1]))
    m20, m50, m200 = sma(c, 20), sma(c, 50), sma(c, 200)
    ok = ~np.isnan(m200)
    # 주봉 하이킨아시 (그 주 금요일까지 확정된 값만 다음 주에 사용 → 미래 참조 없음)
    w = d.resample("W-FRI").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna()
    wg = pd.Series(ha_green(*(w[x].to_numpy(dtype=float) for x in ("Open", "High", "Low", "Close"))), index=w.index)
    wk = wg.shift(1).reindex(d.index, method="ffill").fillna(False).to_numpy(dtype=bool)   # 지난주까지의 주봉 색
    wkp = np.concatenate(([False], wk[:-1]))
    up20, dn20 = c > m20, c < m20
    oldB = g & ~pg & up20; oldS = ~g & pg & dn20
    e = g & up20; pe = np.concatenate(([False], e[:-1])); newB = e & ~pe
    above200 = c > m200
    S = {
        "0 기존 규칙": (oldB, oldS),
        "1 기존 + 200일선 위에서만 매수": (oldB & above200, oldS),
        "2 기존 + 주봉 양봉일 때만 매수": (oldB & wk, oldS),
        "3 기존 매수 + 50일선 아래 음봉전환 때만 매도": (oldB, ~g & pg & (c < m50)),
        "4 기존 매수 + 주봉 음봉 전환 때 매도": (oldB, ~wk & wkp),
        "5 200일선 위면 보유, 아래면 현금": (above200, ~above200),
        "6 넓은 매수(조건 충족일) + 기존 매도": (newB, oldS),
        "7 넓은 매수 + 주봉 음봉 전환 때 매도": (newB, ~wk & wkp),
        "8 주봉 양봉이면 보유, 음봉이면 현금": (wk, ~wk),
        "9 그냥 보유": (np.ones(n, bool), np.zeros(n, bool)),
    }
    for k in S: S[k] = (S[k][0] & ok, S[k][1] & ok if k[0] != "9" else S[k][1])
    return o, c, S, int(np.argmax(ok))


WIN, STEP = 252, 21
LEV = {"TQQQ", "SOXL", "TSLL", "NVDL"}
HOLD = "9 그냥 보유"
rows = {}     # name -> list of (ticker, startYear, ret, mdd, part, holdRet)
for t in TICKERS:
    try:
        d = yf.Ticker(t).history(period="10y", interval="1d", auto_adjust=True).dropna()
        d.index = d.index.tz_localize(None)
        if len(d) < 500: continue
        o, c, S, first = build(d); n = len(c)
        for lo in range(first, n - WIN + 1, STEP):
            hi = lo + WIN
            h = simulate(o, c, *S[HOLD], lo, hi)[0]
            yr = d.index[lo].year
            for name, (ent, ex) in S.items():
                r = simulate(o, c, ent, ex, lo, hi)
                rows.setdefault(name, []).append((t, yr, r[0], r[1], r[2], h))
    except Exception as e_:
        print(t, "ERR", e_)

def table(title, keep):
    print("TABLE", title)
    for name, v in rows.items():
        v = [x for x in v if keep(x)]
        if not v: continue
        r = np.array([x[2] for x in v]); h = np.array([x[5] for x in v])
        print("RESULT %-34s 중간 %6.1f%% 하위25%% %6.1f%% 손실창 %3.0f%% 보유이김 %3.0f%% 보유대비 중간 %6.1f%%p MDD %4.1f%% 참여 %3.0f%% (창 %d)" % (
            name, np.median(r), np.percentile(r, 25), (r < 0).mean() * 100, (r > h).mean() * 100,
            np.median(r - h), np.mean([x[3] for x in v]), np.mean([x[4] for x in v]), len(v)))

table("전체", lambda x: True)
table("레버리지 ETF 제외", lambda x: x[0] not in LEV)
print("TABLE 시작 연도별 중간 수익률(레버리지 제외): 0 기존 / 5 200일선 / 8 주봉 / 9 보유")
years = sorted({x[1] for v in rows.values() for x in v})
keys = {k[0]: k for k in rows}
for y in years:
    out = []
    for k in "0589":
        v = [x[2] for x in rows[keys[k]] if x[1] == y and x[0] not in LEV]
        out.append("%s %6.1f%%" % (k, np.median(v)) if v else "%s    -" % k)
    print("YEAR", y, " | ".join(out))
