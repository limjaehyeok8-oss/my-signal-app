"""야후 주봉·월봉 마지막 봉 중복 여부 확인 + 월봉 볼린저 비교"""
import requests, datetime as dt, math
H = {"User-Agent": "Mozilla/5.0"}
def get(sym, qs): return requests.get("https://query1.finance.yahoo.com/v8/finance/chart/%s?%s" % (sym, qs), headers=H, timeout=30).json()["chart"]["result"][0]
for sym in ["NVDA", "AAPL", "XOM", "SPY"]:
    for qs, nm in [("range=2y&interval=1wk", "주봉"), ("range=10y&interval=1mo", "월봉"), ("range=3mo&interval=1d", "일봉")]:
        r = get(sym, qs); ts = r["timestamp"]; c = r["indicators"]["quote"][0]["close"]
        last = [(dt.datetime.utcfromtimestamp(t).strftime("%m-%d %a %H:%M"), None if x is None else round(x, 2)) for t, x in list(zip(ts, c))[-3:]]
        print("RES", sym, nm, last)
