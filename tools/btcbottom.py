import sys, json, math, urllib.request
import numpy as np, pandas as pd

def cm():
    base="https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
    url=f"{base}?assets=btc&metrics=PriceUSD,CapMVRVCur,CapMrktCurUSD,CapRealUSD&frequency=1d&start_time=2010-07-18&page_size=10000"
    rows=[]
    while url:
        d=json.load(urllib.request.urlopen(url,timeout=60))
        rows+=d["data"]; url=d.get("next_page_url")
    df=pd.DataFrame(rows)
    df["time"]=pd.to_datetime(df["time"]).dt.tz_localize(None).dt.normalize()
    df=df.set_index("time")
    for c in ["PriceUSD","CapMVRVCur","CapMrktCurUSD","CapRealUSD"]:
        if c in df: df[c]=pd.to_numeric(df[c],errors="coerce")
    return df

def yf():
    import yfinance as yf
    h=yf.download("BTC-USD",start="2014-09-17",progress=False,auto_adjust=True)
    h.columns=[c[0] if isinstance(c,tuple) else c for c in h.columns]
    return pd.DataFrame({"PriceUSD":h["Close"]})

try:
    df=cm(); print("CoinMetrics rows",len(df),df.index[0].date(),df.index[-1].date(),flush=True)
    onchain=True
except Exception as e:
    print("CoinMetrics failed:",repr(e)[:200]); df=yf(); onchain=False
    print("yfinance rows",len(df))
df=df[df["PriceUSD"].notna()].copy()
p=df["PriceUSD"]
print("last",df.index[-1].date(),round(p.iloc[-1],0),flush=True)

sma=lambda n:p.rolling(n).mean()
ind={}
w200=sma(1400)
ind["200주선 이하(close≤1.00×)"]=p<=w200*1.00
ind["200주선 +15% 이내(≤1.15×)"]=p<=w200*1.15
pic=(p.ewm(span=150,adjust=False).mean()<0.745*sma(471))
ind["파이사이클 바닥(150EMA<0.745×471SMA)"]=pic
may=p/sma(200)
ind["메이어배수<0.7"]=may<0.7
ind["메이어배수<0.6"]=may<0.6
dd=p/p.cummax()-1
ind["ATH대비 -70%이하"]=dd<=-0.70
ind["ATH대비 -75%이하"]=dd<=-0.75
if onchain and "CapMVRVCur" in df:
    mv=df["CapMVRVCur"]
    ind["MVRV<1 (실현가격 이하)"]=mv<1.0
    ind["MVRV<0.8"]=mv<0.8
    if "CapMrktCurUSD" in df and "CapRealUSD" in df:
        mc=df["CapMrktCurUSD"]; rc=df["CapRealUSD"]
        z=(mc-rc)/mc.expanding(min_periods=720).std()
        ind["MVRV Z-score<0.3"]=z<0.3
        ind["MVRV Z-score<0"]=z<0
wk=p.resample("W").last()
d=wk.diff(); g=d.clip(lower=0).ewm(alpha=1/14,adjust=False).mean(); l=(-d.clip(upper=0)).ewm(alpha=1/14,adjust=False).mean()
rsi=100-100/(1+g/l)
ind["주봉 RSI<35"]=rsi.reindex(p.index,method="ffill")<35
ind["_합성(위 지표 중 3개 이상)"]=None
keys=[k for k in ind if not k.startswith("_")]
cnt=sum(ind[k].fillna(False).astype(int) for k in keys if "+15%" not in k and "−" not in k and "<0.6" not in k and "-75%" not in k and "<0.8" not in k and "<0" not in k.replace("<0.","")  )
ind["_합성(위 지표 중 3개 이상)"]=cnt>=3

# 사이클 저점 (종가 기준)
cyc={"2011":("2011-06-01","2012-06-01"),"2015":("2013-12-01","2015-12-31"),"2018":("2017-12-15","2019-06-30"),"2022":("2021-11-01","2023-06-30"),"2026":("2025-10-01","2026-12-31")}
bottom={}
for k,(a,b) in cyc.items():
    s=p[a:b]
    if len(s): bottom[k]=(s.idxmin(),s.min())
print("\n사이클 저점(종가):",{k:(str(v[0].date()),round(v[1],0)) for k,v in bottom.items()})

def episodes(sig,gap=120):
    s=sig.fillna(False).astype(bool); ev=[]; last=None
    for t in s.index[s.values]:
        if last is None or (t-last).days>gap: ev.append(t)
        last=t
    return ev
H=[30,90,180,365]
def fwd(t):
    i=p.index.get_loc(t); r={}
    for h in H:
        r[h]=(p.iloc[i+h]/p.iloc[i]-1) if i+h<len(p) else np.nan
    w=p.iloc[i+1:i+366]
    r["mdd"]=(w.min()/p.iloc[i]-1) if len(w) else np.nan
    return r
base={h:((p.shift(-h)/p-1).dropna()) for h in H}
print("\n기준(모든 날) 중앙값 수익률:",{h:round(float(base[h].median())*100,1) for h in H})
print("기준(모든 날) 양(+) 비율:",{h:round(float((base[h]>0).mean())*100,1) for h in H})
print("="*70)
def cyc_of(t):
    for k,(a,b) in cyc.items():
        if pd.Timestamp(a)<=t<=pd.Timestamp(b): return k
    return "-"
for k,sig in ind.items():
    if sig is None: continue
    ev=episodes(sig)
    print(f"\n### {k}  (신호일 {int(sig.fillna(False).sum())}일, 에피소드 {len(ev)}개)")
    rows=[]
    for t in ev:
        f=fwd(t); c=cyc_of(t)
        low=bottom.get(c,(None,None))[1]
        away=(low/p[t]-1) if low and c!="-" else np.nan
        rows.append((t,c,p[t],f,away))
        fx=lambda x:"  n/a" if (x!=x) else f"{x*100:+6.0f}%"
        print(f"  {t.date()} [{c}] ${p[t]:>9,.0f}  +30d{fx(f[30])} +90d{fx(f[90])} +180d{fx(f[180])} +365d{fx(f[365])}  1년내최저{fx(f['mdd'])}  사이클저점까지{fx(away)}")
    # 사이클별 최초 신호가 저점에 얼마나 가까운가
    first={}
    for t,c,px,f,away in rows:
        if c not in first: first[c]=(t,px,away)
    print("  ▶ 사이클별 첫 신호→저점까지 추가하락:",{c:(str(v[0].date()),round(v[2]*100)) for c,v in first.items() if v[2]==v[2]})
    covered=[c for c in bottom if any(cc==c for _,cc,_,_,_ in rows)]
    miss=[c for c in bottom if c not in covered and c!="2026"]
    print("  ▶ 신호가 나온 사이클:",covered,"/ 못 잡은 사이클:",miss)
