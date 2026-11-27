# 하이킨아시 음봉(매도) + 200일선 조합 테스트
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
src = open("tools/mix_bt.py").read().split("data = {t: load(t)")[0]
exec(src)
def load_ohlc(t):
    d = yf.download(t, start="2009-01-01", auto_adjust=True, progress=False)
    d.columns = [x[0] if isinstance(x, tuple) else x for x in d.columns]
    return d[["Open", "High", "Low", "Close"]].dropna()
def ha(d):
    c = (d.Open + d.High + d.Low + d.Close) / 4; o = np.zeros(len(d)); o[0] = (d.Open.iloc[0] + d.Close.iloc[0]) / 2
    cv = c.values
    for i in range(1, len(d)): o[i] = (o[i - 1] + cv[i - 1]) / 2
    return o, cv
def ha_weekly_bear(d):                                   # 주봉 하이킨아시 음봉 여부를 일별로 (확정된 주만 사용: 전주 값)
    w = d.resample("W-FRI").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna()
    o, c = ha(w); bear = pd.Series(c < o, index=w.index).shift(1)   # 직전에 끝난 주 기준
    return bear.reindex(d.index, method="ffill").fillna(False).values.astype(bool)
res = {}
for t in ("TQQQ", "SOXL"):
    d = load_ohlc(t); cl = d.Close; cv = cl.values.astype(float); n = len(cv)
    s200 = cl.rolling(200).mean().values; s50 = cl.rolling(50).mean().values
    o, c = ha(d); bear = c < o; bear2 = bear & np.r_[False, bear[:-1]]; wb = ha_weekly_bear(d)
    valid = ~np.isnan(s200); up = cv > s200
    V = lambda x: np.where(valid, x.astype(float), np.nan)
    cases = {
      "현재: 종가>200일선 매수·매도": state(V(up), V(~up)),
      "일봉 HA 음봉이면 매도 (매수는 200일선 위+양봉)": state(V(up & ~bear), V(bear)),
      "200일선 아래 또는 HA 음봉 2일 연속이면 매도": state(V(up & ~bear), V(~up | bear2)),
      "200일선 아래 또는 주봉 HA 음봉이면 매도": state(V(up & ~wb), V(~up | wb)),
      "200일선 위에서만 보유 + 50일선 아래 HA 음봉 때 매도": state(V(up), V(~up | (bear & (cv < s50)))),
      "그냥 보유": np.where(valid, 1.0, np.nan)}
    print("==", t, "연수익 / 최대낙폭 / 칼마 / 전반 후반 / 매매횟수")
    for k, h in cases.items():
        s, tr = sim(d, h); st = stat(s)
        print(f"  {k:36s} {st[0]:5.1f}% / {st[1]:6.1f}% / {st[2]:.2f} / {st[3]:5.1f} {st[4]:5.1f} / {tr}회")
