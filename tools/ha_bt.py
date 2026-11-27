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
rowsx = []
def run_case(d, h): sr, tr = sim(d, h); return stat(sr), tr, sr
out = {}
for t in ("TQQQ", "SOXL"):
    d = load_ohlc(t); cl = d.Close; cv = cl.values.astype(float)
    s200 = cl.rolling(200).mean().values; vd = vidya(cv, 120); sm2 = cl.rolling(2).mean().values
    w = d.resample("W-FRI").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"}).dropna()
    ow, cw = ha(w); bullw = pd.Series((cw >= ow), index=w.index)
    bw = bullw.reindex(d.index, method="ffill").fillna(False).values.astype(bool)
    bw2 = (bullw | bullw.shift(1).fillna(True).astype(bool)).reindex(d.index, method="ffill").fillna(False).values.astype(bool)   # 직전 2주 모두 음봉이어야 음봉 신호
    ok = ~np.isnan(s200) & ~np.isnan(vd)
    V = lambda x: np.where(ok, x.astype(float), np.nan)
    lines = {"200일선": cv > s200, "VIDYA120": cv > vd, "2일평균>VIDYA120": sm2 > vd}
    out[t] = {}
    for ln, up in lines.items():
        out[t][f"매수 {ln} 위 + 주봉 양봉 → 매도 주봉 음봉"] = (d, state(V(up & bw), V(~bw)))
        out[t][f"매수 {ln} 위 + 주봉 양봉 → 매도 주봉 음봉 2주 연속"] = (d, state(V(up & bw2), V(~bw2)))
        out[t][f"매수 {ln} 위 → 매도 주봉 음봉 또는 {ln} 아래"] = (d, state(V(up & bw), V(~bw | ~up)))
    out[t]["기준: 200일선 매수·매도"] = (d, state(V(cv > s200), V(cv <= s200)))
    print("==", t, "연수익 / 최대낙폭 / 칼마 / 전반 후반 / 매매횟수")
    for k, (dd, h) in out[t].items():
        st, tr, _ = run_case(dd, h)
        print(f"  {k:44s} {st[0]:5.1f}% / {st[1]:6.1f}% / {st[2]:.2f} / {st[3]:5.1f} {st[4]:5.1f} / {tr}회")
