"""'거래량 터지면서 하락 = 바닥?' 검증.
배경(과매도): 종가가 볼린저(20,2) 하단 아래 이거나 RSI14 <= 30 인 날.
그 날 중 거래량(20일 평균 대비)·종가 위치(당일 범위 안)에 따라 이후 5/20일 성적과 '더 내려갔는지'를 비교."""
import re, numpy as np, pandas as pd, yfinance as yf

src = open("gs/Picks.gs", encoding="utf-8").read()
SYMS = sorted(set(re.findall(r'"([A-Z][A-Z0-9.\-]{0,6})"', src[src.index("var PICK_GROUPS"):src.index("var PICK_UNIVERSE")])))
LEV = {"NVDL","TQQQ","SOXL","TSLL","BITX","ETHU","LABU","SQQQ","UVXY","TSLQ","NVDQ","FNGU","CONL","MSTU","BULZ","TECL","UPRO","SPXL","YINN","KORU","NUGT","JNUG","DPST","WEBL","HIBL","FAS","TNA","URTY","SOXS"}
rows = []   # 각 신호일 기록

def rsi14(c):
    d = c.diff(); up = d.clip(lower=0); dn = -d.clip(upper=0)
    au = up.ewm(alpha=1/14, adjust=False).mean(); ad = dn.ewm(alpha=1/14, adjust=False).mean()
    return 100 - 100 / (1 + au / ad.replace(0, np.nan))

def proc(sym, df):
    df = df.dropna(subset=["Close", "High", "Low", "Volume"])
    if len(df) < 300: return
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    ma = c.rolling(20).mean(); sd = c.rolling(20).std(ddof=0); lo = ma - 2 * sd
    rs = rsi14(c)
    vr = v / v.rolling(20).mean().shift(1)                     # 거래량 / 직전 20일 평균
    pos = (c - l) / (h - l).replace(0, np.nan)                 # 종가가 당일 범위의 어디(0=저가,1=고가)
    ctx = ((c < lo) & (lo > 0)) | (rs <= 30)
    ret5 = c.pct_change(5)
    n = len(df); last = -99
    cv, lv, hv = c.to_numpy(), l.to_numpy(), h.to_numpy()
    for i in range(25, n - 21):
        if not ctx.iloc[i] or i - last < 10: continue          # 같은 하락 구간(10일 이내)은 한 번만
        last = i
        f5 = cv[i+5] / cv[i] - 1; f20 = cv[i+20] / cv[i] - 1
        mdd = lv[i+1:i+21].min() / cv[i] - 1                    # 20일 안 최저 (추가 하락)
        newlow = lv[i+1:i+21].min() < lv[i]                     # 그날 저가를 다시 깼는지
        rows.append((sym, df.index[i].year, vr.iloc[i], pos.iloc[i], ret5.iloc[i], f5, f20, mdd, newlow))

for i in range(0, len(SYMS), 40):
    part = SYMS[i:i+40]
    try: df = yf.download(part, period="10y", interval="1d", auto_adjust=False, progress=False, group_by="ticker", threads=True)
    except Exception as e: print("ERR", e); continue
    for t in part:
        if t in LEV: continue
        try: proc(t, df[t])
        except Exception as e: pass

A = pd.DataFrame(rows, columns=["s","yr","vr","pos","r5","f5","f20","mdd","newlow"]).dropna()
print("RES 종목 %d개 / 과매도 배경 신호 %d개 (같은 하락 10일 이내 중복 제거)" % (A.s.nunique(), len(A)))
def st(mask, label):
    x = A[mask]
    if len(x) < 30: print("RES %-34s 건수 %5d (적음)" % (label, len(x))); return
    print("RES %-34s 건수 %5d | 5일 평균 %+5.1f%% | 20일 평균 %+5.1f%% 중앙 %+5.1f%% 승률 %3.0f%% | 20일내 최저 평균 %+5.1f%% | 당일 저가 재이탈 %3.0f%%" % (
        label, len(x), 100*x.f5.mean(), 100*x.f20.mean(), 100*x.f20.median(), 100*(x.f20 > 0).mean(), 100*x.mdd.mean(), 100*x.newlow.mean()))
print("RES === 과매도 배경(볼밴 하단 이탈 or RSI<=30) 안에서 비교")
st(A.vr > -1, "전체(기준)")
st(A.vr < 0.8, "거래량 적음 (<0.8배)")
st((A.vr >= 0.8) & (A.vr < 1.5), "거래량 보통 (0.8~1.5배)")
st((A.vr >= 1.5) & (A.vr < 2.5), "거래량 많음 (1.5~2.5배)")
st(A.vr >= 2.5, "거래량 폭증 (2.5배 이상)")
st(A.vr >= 3.5, "거래량 대폭증 (3.5배 이상)")
print("RES === 거래량 폭증(2.5배+) 중 종가 위치별")
st((A.vr >= 2.5) & (A.pos >= 0.67), "  종가 당일범위 위쪽 1/3 (아래꼬리)")
st((A.vr >= 2.5) & (A.pos >= 0.34) & (A.pos < 0.67), "  종가 가운데")
st((A.vr >= 2.5) & (A.pos < 0.34), "  종가 아래쪽 1/3 (저가 마감)")
print("RES === 거래량 평범(<1.5배) 중 종가 위치별 (비교용)")
st((A.vr < 1.5) & (A.pos >= 0.67), "  종가 위쪽 1/3")
st((A.vr < 1.5) & (A.pos < 0.34), "  종가 아래쪽 1/3")
print("RES === 사전 급락(직전 5일 -8% 이하) 만")
st(A.r5 <= -0.08, "급락 후 전체")
st((A.r5 <= -0.08) & (A.vr >= 2.5), "급락 후 + 거래량 폭증")
st((A.r5 <= -0.08) & (A.vr >= 2.5) & (A.pos >= 0.67), "급락 후 + 폭증 + 위쪽 마감")
print("RES === 연도별: 거래량 폭증+위쪽 마감 vs 거래량 폭증+저가 마감 (20일 평균)")
for y in sorted(A.yr.unique()):
    a = A[(A.yr == y) & (A.vr >= 2.5) & (A.pos >= 0.67)]; b = A[(A.yr == y) & (A.vr >= 2.5) & (A.pos < 0.34)]; z = A[A.yr == y]
    print("RES %d  전체 %5d건 %+5.1f%% | 폭증+위마감 %4d건 %+5.1f%% | 폭증+저가마감 %4d건 %+5.1f%%" % (y, len(z), 100*z.f20.mean(), len(a), 100*a.f20.mean() if len(a) else 0, len(b), 100*b.f20.mean() if len(b) else 0))
