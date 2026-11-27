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
for t in ("TQQQ", "SOXL"):
    d = load_ohlc(t); cv = d.Close.values.astype(float)
    o, c = ha(d); bull_d = (c >= o).astype(float)
    w = d.resample("W-FRI").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna()
    ow, cw = ha(w); bw = pd.Series((cw >= ow).astype(float), index=w.index).reindex(d.index, method="ffill").values
    bw = np.where(np.isnan(bw), np.nan, bw)
    # 2주 연속 음봉이면 매도 (덜 민감)
    b2 = pd.Series((cw >= ow).astype(float), index=w.index); b2 = ((b2 + b2.shift(1)) > 0).astype(float).reindex(d.index, method="ffill").values
    cases = {"일봉 HA: 양봉이면 보유 · 음봉이면 매도": bull_d, "주봉 HA: 양봉이면 보유 · 음봉이면 매도": bw, "주봉 HA: 음봉 2주 연속이면 매도": b2, "그냥 보유": np.ones(len(d))}
    print("==", t, "연수익 / 최대낙폭 / 칼마 / 전반 후반 / 매매횟수")
    for k, h in cases.items():
        h = h.copy(); h[:30] = np.nan
        sr, tr = sim(d, h); st = stat(sr)
        print(f"  {k:36s} {st[0]:5.1f}% / {st[1]:6.1f}% / {st[2]:.2f} / {st[3]:5.1f} {st[4]:5.1f} / {tr}회")
