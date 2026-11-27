# 나스닥 고점 대비 하락률 현황 + 과거 통계 (^IXIC 1971~, ^NDX 1985~)
import yfinance as yf, pandas as pd, numpy as np

def load(t):
    d = yf.download(t, start="1971-01-01", auto_adjust=False, progress=False)
    c = d["Close"]
    if isinstance(c, pd.DataFrame): c = c.iloc[:, 0]
    return c.dropna()

def episodes(p, min_dd=-0.10):
    """고점→저점→회복 에피소드. 고점 대비 min_dd 이상 빠진 것만."""
    peak = p.cummax(); dd = p / peak - 1
    out = []; i = 0; idx = p.index
    inep = False
    for k in range(len(p)):
        if dd.iloc[k] == 0:
            if inep:
                seg = dd.iloc[s:k]; tr = seg.idxmin()
                if seg.min() <= min_dd:
                    out.append((idx[s-1], tr, idx[k], float(seg.min())))
                inep = False
        elif not inep:
            inep = True; s = k
    if inep:
        seg = dd.iloc[s:]; tr = seg.idxmin()
        if seg.min() <= min_dd: out.append((idx[s-1], tr, None, float(seg.min())))
    return out

for name in ["^IXIC", "^NDX"]:
    p = load(name)
    print("=" * 70); print(name, p.index[0].date(), "~", p.index[-1].date(), len(p), "일")
    peak = p.cummax(); dd = p / peak - 1
    ath = p.idxmax()
    print(f"[현재] 종가 {p.iloc[-1]:,.1f} ({p.index[-1].date()}) · 최고가 {p.max():,.1f} ({ath.date()}) · 고점 대비 {dd.iloc[-1]*100:.1f}%")
    print(f"       최근 고점 이후 {len(p[ath:])-1}거래일 경과, 52주 고점 대비 {(p.iloc[-1]/p.iloc[-252:].max()-1)*100:.1f}%, 200일선 대비 {(p.iloc[-1]/p.iloc[-200:].mean()-1)*100:.1f}%")
    eps = episodes(p, -0.10)
    print(f"\n[고점 대비 -10% 이상 하락 에피소드 {len(eps)}개]  고점일 → 저점일 (최대하락, 고점→저점 일수, 저점→회복 일수)")
    for a, t, r, d in eps:
        rec = f"{(r - t).days}일" if r is not None else "회복 전"
        print(f"  {a.date()} → {t.date()}  {d*100:6.1f}%  고점→저점 {(t - a).days:4d}일  저점→회복 {rec}")
    mdds = np.array([e[3] for e in eps])
    print("\n[하락 깊이 분포]")
    for th in [-0.10, -0.15, -0.20, -0.25, -0.30, -0.40, -0.50]:
        n_reach = int((mdds <= th).sum())
        print(f"  -{abs(th)*100:.0f}%까지 간 에피소드 {n_reach}개 ({n_reach/len(mdds)*100:.0f}%)")
    print("\n[낙폭별: 처음 그 깊이에 닿았을 때 → 그 뒤 추가 하락 / 이후 수익률]")
    print("  낙폭   횟수  추가로 더 빠진 평균  중앙값  최대   | 6개월뒤 평균(승률) | 12개월뒤 평균(승률)")
    for th in [-0.10, -0.15, -0.20, -0.25, -0.30, -0.35, -0.40]:
        cross = []
        prev_ep_peak = None
        # 에피소드마다 처음 th 아래로 내려간 날
        for a, t, r, d in eps:
            seg = dd[a:(r if r is not None else p.index[-1])]
            hit = seg[seg <= th]
            if len(hit): cross.append((hit.index[0], t))
        if not cross: continue
        extra, r6, r12 = [], [], []
        for day, tr in cross:
            extra.append(dd[tr] / (1) - dd[day])          # 닿은 날 낙폭 → 저점 낙폭 (퍼센트포인트)
            # 닿은 날 종가 대비 저점까지 추가 하락률
        add = []
        for day, tr in cross:
            add.append(p[tr] / p[day] - 1)
            i = p.index.get_loc(day)
            if i + 126 < len(p): r6.append(p.iloc[i + 126] / p.iloc[i] - 1)
            if i + 252 < len(p): r12.append(p.iloc[i + 252] / p.iloc[i] - 1)
        add = np.array(add); r6 = np.array(r6); r12 = np.array(r12)
        f = lambda a: (f"{a.mean()*100:+5.1f}% ({(a>0).mean()*100:3.0f}%)" if len(a) else "  -  ")
        print(f"  {th*100:5.0f}% {len(cross):3d}   {add.mean()*100:7.1f}%        {np.median(add)*100:6.1f}% {add.min()*100:6.1f}% | {f(r6)}  | {f(r12)}")
    # 현재와 같은 낙폭 구간
    cur = dd.iloc[-1]
    print(f"\n[지금({cur*100:.1f}%)과 비슷한 낙폭(±2%p)이었던 날 → 이후]")
    m = dd[(dd - cur).abs() <= 0.02]
    m = m[m.index < p.index[-1] - pd.Timedelta(days=380)]
    r6 = []; r12 = []; worse = []
    for day in m.index:
        i = p.index.get_loc(day)
        r6.append(p.iloc[i+126]/p.iloc[i]-1) if i+126 < len(p) else None
        r12.append(p.iloc[i+252]/p.iloc[i]-1) if i+252 < len(p) else None
        worse.append(dd.iloc[i:i+252].min() - dd.iloc[i])
    if len(m):
        r6 = np.array(r6); r12 = np.array(r12); worse = np.array(worse)
        print(f"  해당 일수 {len(m)}일 · 6개월뒤 평균 {r6.mean()*100:+.1f}% 승률 {(r6>0).mean()*100:.0f}% · 12개월뒤 평균 {r12.mean()*100:+.1f}% 승률 {(r12>0).mean()*100:.0f}% · 이후 1년 내 낙폭이 {worse.mean()*100:.1f}%p 더 깊어짐(평균), 최악 {worse.min()*100:.1f}%p")
    # 최근 120일 낙폭 흐름
    print("\n[최근 낙폭 흐름 (월말)]")
    print((dd.resample("M").last().tail(14) * 100).round(1).to_string())
