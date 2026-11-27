# 고점에서 더 빨리 팔기: 200일선 ±5% 규칙 + "매수 후 고점 대비 -X% 하락하면 매도(트레일링)" 추가
import yfinance as yf, pandas as pd, numpy as np, warnings
warnings.filterwarnings("ignore")
exec(open("tools/mix_bt.py").read().split("data = {t: load(t)")[0])
D = {t: load(t) for t in ("TQQQ", "SOXL")}
def rule(d, x, rebuy):
    cl = d.Close; cv = cl.values.astype(float); s = cl.rolling(200).mean().values; m20 = cl.rolling(20).mean().values; n = len(cv)
    h = np.full(n, np.nan); cur = 0; peak = 0; wait = False
    for i in range(n):
        if np.isnan(s[i]): continue
        if cur == 0:
            ok = cv[i] > s[i] * 1.05
            if wait: ok = ok and cv[i] > m20[i] and cv[i] > rebuy * 0 + m20[i]          # 트레일링으로 판 뒤엔 20일선 위로 올라와야 재진입
            if ok: cur = 1; peak = cv[i]; wait = False
        else:
            peak = max(peak, cv[i])
            if cv[i] < s[i] * 0.95: cur = 0; wait = False
            elif x and cv[i] < peak * (1 - x): cur = 0; wait = True
        h[i] = cur
    return h
res = {}
print("연수익 / 최대낙폭 / 칼마 / 전반 후반 / 매매횟수")
for x in (None, 0.20, 0.25, 0.30, 0.35, 0.40):
    nm = "트레일링 없음(현재 규칙)" if x is None else f"고점 대비 -{int(x*100)}%면 매도 추가"
    ss = {}
    for t, d in D.items():
        sr, tr = sim(d, rule(d, x, 0)); ss[t] = (sr, tr)
        st = stat(sr); print(f"  {t:5s} {nm:30s} {st[0]:5.1f}% / {st[1]:6.1f}% / {st[2]:.2f} / {st[3]:5.1f} {st[4]:5.1f} / {tr}회")
    j = pd.concat([ss["TQQQ"][0], ss["SOXL"][0]], axis=1).dropna(); mix = (j.pct_change().mean(axis=1).fillna(0) + 1).cumprod(); st = stat(mix)
    print(f"  반반  {nm:30s} {st[0]:5.1f}% / {st[1]:6.1f}% / {st[2]:.2f} / {st[3]:5.1f} {st[4]:5.1f} / {ss['TQQQ'][1] + ss['SOXL'][1]}회")
