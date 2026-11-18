"""NVDA 월봉 볼린저 하단: 앱(야후 chart API) 값과 트레이딩뷰/토스 값이 왜 다른지 확인"""
import requests, datetime as dt, math, json
H = {"User-Agent": "Mozilla/5.0"}
def get(url):
    return requests.get(url, headers=H, timeout=30).json()["chart"]["result"][0]
def bb(c, n=20, k=2, sample=False):
    w = c[-n:]; m = sum(w) / n
    v = sum((x - m) ** 2 for x in w) / (n - 1 if sample else n)
    sd = math.sqrt(v); return m - k * sd, m, m + k * sd
for sym in ["NVDA"]:
    r = get("https://query1.finance.yahoo.com/v8/finance/chart/%s?range=10y&interval=1mo" % sym)
    ts = r["timestamp"]; q = r["indicators"]["quote"][0]; adj = r["indicators"].get("adjclose", [{}])[0].get("adjclose")
    print("RES meta price", r["meta"].get("regularMarketPrice"), "bars", len(ts))
    rows = [(t, q["open"][i], q["high"][i], q["low"][i], q["close"][i], adj[i] if adj else None) for i, t in enumerate(ts)]
    for t, o, h, l, c, a in rows[-8:]:
        print("RES", dt.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d %H:%M"), "o", o, "h", h, "l", l, "c", c, "adj", a)
    cl = [c for _, _, _, _, c, _ in rows if c is not None]
    print("RES n closes", len(cl))
    print("RES 앱 방식(마지막 포함, 모집단)", [round(x, 2) for x in bb(cl)])
    print("RES 표본표준편차", [round(x, 2) for x in bb(cl, sample=True)])
    print("RES 마지막 봉 제외(확정 월봉만)", [round(x, 2) for x in bb(cl[:-1])])
    if len(cl) > 2 and dt.datetime.utcfromtimestamp(rows[-1][0]).day != 1:
        print("RES 마지막 봉 날짜가 1일이 아님 → 중복/임시 봉 의심. 마지막 2개 제외:", [round(x, 2) for x in bb(cl[:-2] + cl[-1:])])
    if adj:
        ad = [a for a in adj if a is not None]; print("RES 수정종가(배당조정) 기준", [round(x, 2) for x in bb(ad)])
    # 일봉으로 직접 월봉 재구성 (캘린더 월 마지막 거래일 종가, 이번 달은 현재가)
    d = get("https://query1.finance.yahoo.com/v8/finance/chart/%s?range=10y&interval=1d" % sym)
    dts = d["timestamp"]; dc = d["indicators"]["quote"][0]["close"]
    by = {}
    for t, c in zip(dts, dc):
        if c is None: continue
        by[dt.datetime.utcfromtimestamp(t).strftime("%Y-%m")] = c
    mc = [by[k] for k in sorted(by)]
    print("RES 일봉에서 직접 만든 월봉 종가 마지막 6개", [(k, round(by[k], 2)) for k in sorted(by)[-6:]])
    print("RES 일봉기반 월봉 BB", [round(x, 2) for x in bb(mc)])
    print("RES 월봉 20개 평균/최근", round(sum(mc[-20:]) / 20, 2), round(mc[-1], 2))
