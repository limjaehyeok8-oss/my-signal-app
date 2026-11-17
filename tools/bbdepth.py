"""주봉 볼린저(20, 2) 하단을 얼마나 깊게 이탈했을 때 성적이 어땠나 — 괴리율 구간별 통계.
추천 대상 종목(Picks.gs)의 10년 주봉. 괴리율 = 종가가 하단 밴드보다 얼마나 아래인지(%).
각 주(週)마다 '그 시점 종가에서 사서 h주 뒤 종가에 팔았다면'을 계산. 비교 기준(baseline)은 모든 주."""
import re, numpy as np, yfinance as yf

src = open("gs/Picks.gs", encoding="utf-8").read()
SYMS = sorted(set(re.findall(r'"([A-Z][A-Z0-9.\-]{0,6})"', src[src.index("var PICK_GROUPS"):src.index("var PICK_UNIVERSE")])))
LEV = {"NVDL", "TQQQ", "SOXL", "TSLL", "BITX", "ETHU", "LABU", "SQQQ", "UVXY", "TSLQ", "NVDQ", "FNGU", "CONL", "MSTU", "BULZ", "TECL", "UPRO", "SPXL", "YINN", "KORU", "NUGT", "JNUG", "DPST", "WEBL", "HIBL", "FAS", "TNA", "URTY", "SOXS"}
HS = (4, 8, 13)
rows = []   # (sym, gap%, sigmaDepth, f4, f8, f13, dd8, vol)

def calc(sym, c):
    n = len(c)
    if n < 90: return
    for k in range(72, n):
        w = c[k - 19:k + 1]; m = w.mean(); sd = w.std()
        if sd <= 0 or c[k] < 3: continue
        lower = m - 2 * sd
        gap = (c[k] / lower - 1) * 100
        sig = (lower - c[k]) / sd
        f = [(c[k + h] / c[k] - 1) * 100 if k + h < n else np.nan for h in HS]
        dd8 = (c[k + 1:k + 9].min() / c[k] - 1) * 100 if k + 8 < n else np.nan
        r = np.diff(c[k - 52:k + 1]) / c[k - 52:k]
        vol = r.std() * np.sqrt(52) * 100
        rows.append((sym, gap, sig, f[0], f[1], f[2], dd8, vol))

for i in range(0, len(SYMS), 40):
    part = SYMS[i:i + 40]
    try: df = yf.download(part, period="10y", interval="1wk", auto_adjust=True, progress=False, group_by="ticker", threads=True)
    except Exception as e: print("ERR", e); continue
    for t in part:
        try:
            c = df[t]["Close"].dropna().to_numpy(float)
            calc(t, c)
        except Exception: pass

A = np.array([(r[1], r[2], r[3], r[4], r[5], r[6], r[7]) for r in rows if r[0] not in LEV])
S = np.array([r[0] for r in rows if r[0] not in LEV])
print("RES 종목 %d개, 주(週) 관측 %d개 (레버리지 ETF 제외)" % (len(set(S)), len(A)))
gap, sig, f4, f8, f13, dd8, vol = A.T

def stat(mask, label, base8=None):
    m = mask & ~np.isnan(f8)
    if m.sum() < 15: print("RES %-22s 관측 %4d (너무 적어서 생략)" % (label, m.sum())); return
    x = f8[m]; y = f4[m & ~np.isnan(f4)]; z = f13[m & ~np.isnan(f13)]
    d = dd8[m & ~np.isnan(dd8)]
    print("RES %-22s 관측 %5d 종목 %3d | 4주 %+5.1f%% | 8주 평균 %+5.1f%% 중앙 %+5.1f%% 승률 %3.0f%% 하위10%% %+6.1f%% | 13주 %+5.1f%% | 8주내 추가하락 평균 %+5.1f%%%s" % (
        label, m.sum(), len(set(S[m])), y.mean(), x.mean(), np.median(x), 100 * (x > 0).mean(), np.percentile(x, 10), z.mean(), d.mean(),
        "" if base8 is None else " | 기준대비 %+5.1f%%p" % (x.mean() - base8)))
    return x.mean()

allm = np.ones(len(gap), bool)
base = f8[~np.isnan(f8)].mean()
print("RES --- 기준(모든 주) 8주 평균 %+.1f%% 승률 %.0f%%" % (base, 100 * (f8[~np.isnan(f8)] > 0).mean()))
stat(gap >= 0, "밴드 안(괴리율 ≥ 0)", base)
print("RES === 괴리율 구간별 (종가가 하단보다 몇 % 아래)")
B = [(0, -2), (-2, -5), (-5, -10), (-10, -15), (-15, -25), (-25, -100)]
for hi, lo in B: stat((gap < hi) & (gap >= lo), "%d%% ~ %d%%" % (hi, lo), base)
stat(gap < 0, "하단 이탈 전체", base)
print("RES === σ(표준편차) 깊이별 (하단에서 몇 σ 아래)")
for a, b in [(0, 0.25), (0.25, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 9)]: stat((sig > a) & (sig <= b), "%.2fσ ~ %.2fσ" % (a, b), base)
print("RES === 변동성 그룹 × 괴리율 (연 변동성 저 <35% / 중 35~60% / 고 ≥60%)")
for vn, vm in (("저변동", vol < 35), ("중변동", (vol >= 35) & (vol < 60)), ("고변동", vol >= 60)):
    vb = f8[vm & ~np.isnan(f8)].mean() if (vm & ~np.isnan(f8)).sum() else 0
    print("RES [%s] 기준 8주 평균 %+.1f%%" % (vn, vb))
    for hi, lo in [(0, -3), (-3, -7), (-7, -15), (-15, -100)]: stat(vm & (gap < hi) & (gap >= lo), "  %s %d~%d%%" % (vn, hi, lo), vb)
