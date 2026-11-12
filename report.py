import yfinance as yf
import pandas as pd
import requests
import os
import io
import math
import html
import json
import re
import numpy as np
from datetime import datetime
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor

# ==========================================
# 0. 조정 가능한 설정값
# ==========================================
# 저평가 스크리닝
PE_MAX = 15            # PER 상한 (선행PER 우선, 없으면 후행PER)
MIN_DRAWDOWN = 0.20    # 52주 고점 대비 이 비율 이상 빠진 종목만 ("가격이 눌린" 종목)
MIN_ROE = 0.10         # ROE 하한 (적자/부실 기업 걸러내기)
MIN_PE = 3             # 이보다 낮은 PER은 데이터 오류/일시적 이익 급증일 가능성이 커서 제외 (None이면 끔)
MAX_DEBT_TO_EQUITY = 150  # 부채비율(%) 상한. 빚으로 ROE를 부풀린 기업 제외 (None이면 끔)
MAX_PRICE = None       # 주가 절대값 상한(달러). 필요 없으면 None, 예: 50
VALUE_TOP_N = 7
STAR_DRAWDOWN = 0.40   # 52주 고점 대비 이 비율 이상 빠진 종목은 ★ 표시

# 강세 우량주
STRONG_TOP_N = 5

# 실적 발표
EARNINGS_TOP_N = 6     # 시가총액 큰 순서로 이만큼만 표시, 나머지는 '외 N개'

# 공포 구간 통계
FG_FEAR_MAX = 45          # 공포탐욕 점수가 이 값 미만이면 '공포'로 간주 (CNN 기준 공포 25~44, 극공포 0~24)
FG_HISTORY_START = "2015-01-01"
FG_CSV_URL = "https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv"  # CNN 과거 데이터가 짧거나 실패할 때 대체 (2011~)
FWD_DAYS = (20, 60)       # 공포 N일째 매수했을 때 이후 수익률을 볼 기간 (거래일)
MIN_SAMPLES = 8           # 과거 사례가 이보다 적으면 '표본 부족'으로 표시

# 거시 지표 기준
TNX_RISK_THRESHOLD = 4.5
OIL_HIGH, OIL_LOW = 85, 65
VIX_RISK = 20

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

# GitHub Actions 등은 UTC라서 요일/날짜가 하루 어긋날 수 있어 한국시간 기준으로 맞춤
# (실행 시각에 따라 기준이 달라져야 하면 이 줄만 바꾸면 됨)
today = datetime.now(ZoneInfo('Asia/Seoul')).date()
is_monday = (today.weekday() == 0)

# ==========================================
# 1. 환경 변수 및 알림 설정
# ==========================================
token = os.getenv('TELEGRAM_TOKEN')
chat_id = os.getenv('TELEGRAM_CHAT_ID')
finnhub_token = os.getenv('FINNHUB_TOKEN')


def send_message(text):
    if not token or not chat_id:
        print(text)
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"

    # 텔레그램은 한 메시지 4096자 제한 -> 줄 단위로 나눠서 전송
    chunks, cur = [], ""
    for line in text.split("\n"):
        if len(cur) + len(line) + 1 > 3800:
            chunks.append(cur)
            cur = ""
        cur += line + "\n"
    if cur.strip():
        chunks.append(cur)

    for c in chunks:
        try:
            r = requests.post(url, data={
                'chat_id': chat_id,
                'text': c,
                'parse_mode': 'HTML',
                'disable_web_page_preview': True,
                'disable_notification': True,
            }, timeout=20)
            if not r.ok:
                print(f"텔레그램 전송 실패: {r.status_code} {r.text[:200]}")
        except Exception as e:
            print(f"텔레그램 전송 에러: {e}")


# ==========================================
# 2. 공통 유틸
# ==========================================
def num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def pct(x):
    return f"{x * 100:+.1f}%"


def download_close(symbols, period='1y', chunk=100):
    """여러 종목 종가를 한 번에 받아 DataFrame(열=티커)으로 반환"""
    frames = []
    for i in range(0, len(symbols), chunk):
        part = symbols[i:i + chunk]
        try:
            df = yf.download(part, period=period, interval='1d',
                             progress=False, auto_adjust=True, threads=True)
            if df.empty:
                continue
            c = df['Close']
            if isinstance(c, pd.Series):
                c = c.to_frame(part[0])
            frames.append(c)
        except Exception as e:
            print(f"가격 다운로드 실패: {e}")
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, axis=1).dropna(how='all')


def fetch_info(sym):
    try:
        return sym, yf.Ticker(sym).info
    except Exception as e:
        print(f"info 조회 실패 ({sym}): {e}")
        return sym, None


def market_cap(sym):
    try:
        fi = yf.Ticker(sym).fast_info
        for key in ('market_cap', 'marketCap'):
            try:
                v = num(fi[key])
                if v:
                    return v
            except Exception:
                continue
    except Exception as e:
        print(f"시가총액 조회 실패 ({sym}): {e}")
    return 0


# ==========================================
# 3. 시장 데이터
# ==========================================
FG_KOR = {"extreme fear": "😱 극공포", "fear": "😨 공포", "neutral": "😐 중립",
          "greed": "🤑 탐욕", "extreme greed": "🔥 극탐욕"}


def load_fg_history_csv():
    """공포탐욕 일별 점수(2011~) 대체 소스"""
    try:
        r = requests.get(FG_CSV_URL, headers=UA, timeout=20)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        df['date'] = pd.to_datetime(df['Date']).dt.normalize()
        return df.groupby('date')['Fear Greed'].last().astype(float)
    except Exception as e:
        print(f"공포탐욕 대체 데이터 조회 실패: {e}")
        return None


def fetch_fear_greed():
    """CNN 공포탐욕 지수 -> (현재 점수, 등급, 과거 일별 점수 Series 또는 None). 실패 시 None"""
    headers = dict(UA, Accept="application/json", Referer="https://edition.cnn.com/")
    base = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
    data = None
    for u in (f"{base}/{FG_HISTORY_START}", base):   # 과거 데이터 포함 URL 먼저, 안 되면 기본 URL
        try:
            r = requests.get(u, headers=headers, timeout=15)
            r.raise_for_status()
            data = r.json()
            break
        except Exception as e:
            print(f"공포탐욕 조회 실패 ({u}): {e}")
    if data is None:
        return None
    try:
        score = int(data['fear_and_greed']['score'])
        rating = data['fear_and_greed']['rating']
    except Exception as e:
        print(f"공포탐욕 파싱 에러: {e}")
        return None

    hist = None
    try:
        h = pd.DataFrame(data['fear_and_greed_historical']['data'])
        h['date'] = pd.to_datetime(h['x'], unit='ms').dt.normalize()
        hist = h.groupby('date')['y'].last().astype(float)
    except Exception as e:
        print(f"공포탐욕 과거 데이터 파싱 에러: {e}")

    print(f"CNN 과거 데이터: {0 if hist is None else len(hist)}일")
    if hist is None or len(hist) < 1000:                  # 짧으면 대체 소스 사용
        alt = load_fg_history_csv()
        if alt is not None and len(alt) > (0 if hist is None else len(hist)):
            hist = alt
            print(f"대체 데이터 사용: {len(hist)}일 ({hist.index.min().date()} ~ {hist.index.max().date()})")
    if hist is not None:                                  # 오늘 점수는 실시간 값으로 덧붙임
        live_date = pd.Timestamp(today)
        if live_date > hist.index.max():
            hist = pd.concat([hist, pd.Series([float(score)], index=[live_date])])
    return score, rating, hist


def fear_streak_stats(hist, live_fear):
    """공포(점수 < FG_FEAR_MAX)가 연속 N일째일 때, 과거 같은 N일째에 SPY를 샀다면 이후 수익률이 어땠는지.
    반환: (현재 연속일수, {보유일: (평균수익률, 승률, 사례수)}, {보유일: (전체 평균, 전체 승률)}) 또는 None"""
    if not live_fear:
        return None
    if hist is None or len(hist) < 300:
        print(f"공포 통계 생략: 과거 데이터 부족 ({0 if hist is None else len(hist)}일)")
        return None
    spy = download_close(['SPY'], period='max')
    if spy.empty or 'SPY' not in spy:
        print("공포 통계 생략: SPY 가격 조회 실패")
        return None
    spy = spy['SPY'].dropna()
    if getattr(spy.index, 'tz', None) is not None:
        spy.index = spy.index.tz_localize(None)
    spy.index = pd.to_datetime(spy.index).normalize()

    h = hist[hist.index.dayofweek < 5]                          # 주말 제외(거래일 기준 연속 일수)
    fear = h < FG_FEAR_MAX
    streak = fear.groupby((~fear).cumsum()).cumsum()            # 연속 공포 일수
    cur = max(int(streak.iloc[-1]), 1)

    df = pd.concat([streak.rename('streak'), spy.rename('spy')], axis=1, join='inner').dropna()
    if len(df) < 500:
        print(f"공포 통계 생략: 점수·가격 겹치는 기간 부족 ({len(df)}일)")
        return None
    for h in FWD_DAYS:
        df[f'f{h}'] = df['spy'].shift(-h) / df['spy'] - 1       # h거래일 뒤 수익률

    obs = df[df['streak'] == cur]    # 공포 연속 N일째가 된 날 = 사례당 1일 (겹침 방지)

    res, base = {}, {}
    for h in FWD_DAYS:
        r = obs[f'f{h}'].dropna()
        res[h] = (r.mean() if len(r) else np.nan, (r > 0).mean() if len(r) else np.nan, len(r))
        a = df[f'f{h}'].dropna()
        base[h] = (a.mean(), (a > 0).mean())
    return cur, res, base


def fear_stats_text(stats):
    cur, res, base = stats
    hmax = max(FWD_DAYS)
    n = res[hmax][2]
    if n < MIN_SAMPLES:
        return f"과거 공포 {cur}일째 도달 {n}회 (표본 부족)"

    parts = [f"{h}일 후 {res[h][0] * 100:+.1f}%(승률 {res[h][1] * 100:.0f}%)" for h in FWD_DAYS]
    base_txt = " / ".join(f"{h}일 {base[h][0] * 100:+.1f}%" for h in FWD_DAYS)
    m, w, _ = res[hmax]
    if m > base[hmax][0] and w >= 0.65:
        tag = "평균보다 좋았던 구간"
    elif m < base[hmax][0] or w < 0.5:
        tag = "평균보다 부진했던 구간"
    else:
        tag = "평균과 비슷"
    return (f"과거 공포 {cur}일째 도달 {n}회: " + " · ".join(parts)
            + f"\n전체 평균 {base_txt} → {tag}")


MACRO_TICKERS = ['^TNX', '^FVX', '^VIX', 'CL=F', 'GC=F', 'DX-Y.NYB']


def get_macro_snapshot():
    """(요약 텍스트, 경계 신호 개수) 반환. 실패 시 (None, 0)"""
    data = {}
    for sym in MACRO_TICKERS:
        try:
            h = yf.Ticker(sym).history(period='5d')['Close'].dropna()
            if len(h) >= 2:
                data[sym] = (float(h.iloc[-1]), float(h.iloc[-2]))
        except Exception as e:
            print(f"매크로 지표 조회 실패 ({sym}): {e}")

    if '^TNX' not in data:
        return None, 0

    score, lines = 0, []

    # 10년물: 변동은 %가 아니라 bp(0.01%p)로 표시
    c, p = data['^TNX']
    bp = (c - p) * 100
    if bp > 0:
        score += 1
    if c >= TNX_RISK_THRESHOLD:
        score += 1
        tag = "⚠️ 위험 구간"
    else:
        tag = "정상"
    lines.append(f"10년물 금리 {c:.2f}% ({bp:+.0f}bp) · {tag}")

    if '^VIX' in data:
        c, p = data['^VIX']
        if c >= VIX_RISK:
            score += 1
            tag = "⚠️ 변동성 확대"
        else:
            tag = "안정"
        lines.append(f"VIX {c:.1f} · {tag}")

    if 'CL=F' in data:
        c, p = data['CL=F']
        chg = (c - p) / p * 100 if p else 0
        if chg > 2:
            score += 1
        if c >= OIL_HIGH:
            score += 1
            tag = "⚠️ 인플레 우려"
        elif c <= OIL_LOW:
            score += 1
            tag = "⚠️ 침체 우려"
        else:
            tag = "정상"
        lines.append(f"WTI ${c:.2f} ({chg:+.2f}%) · {tag}")

    extra = []
    if 'GC=F' in data:
        c, p = data['GC=F']
        chg = (c - p) / p * 100 if p else 0
        if chg > 1:
            score += 1
        extra.append(f"금 ${c:,.0f} ({chg:+.2f}%)")
    if 'DX-Y.NYB' in data:
        c, p = data['DX-Y.NYB']
        chg = (c - p) / p * 100 if p else 0
        if chg > 0.3:
            score += 1
        extra.append(f"달러인덱스 {c:.2f} ({chg:+.2f}%)")
    if extra:
        lines.append(" / ".join(extra))

    if '^FVX' in data and data['^TNX'][0] - data['^FVX'][0] < 0:
        score += 1
        lines.append("⚠️ 장단기 금리 역전 (10년물이 5년물보다 낮음)")

    if score >= 3:
        summary = f"🚨 종합: 위험자산 비우호적 (경계 {score}개)"
    elif score >= 1:
        summary = f"종합: 일부 경계 신호 ({score}개)"
    else:
        summary = "종합: 위험자산 우호적"

    return "\n".join(lines + [summary]), score


# ==========================================
# 4. 종목 선별
# ==========================================
# 시장이 안 좋을 때도 상대적으로 버티는 후보군 (결제/필수소비재/헬스케어/유틸/금융/에너지 + 금·채권 ETF)
STRONG_POOL = [
    'V', 'MA', 'AXP', 'PYPL',
    'WMT', 'COST', 'PG', 'KO', 'PEP', 'MCD', 'TJX', 'MDLZ', 'CL',
    'JNJ', 'LLY', 'ABBV', 'MRK', 'UNH', 'ABT', 'TMO',
    'DUK', 'SO', 'NEE', 'CEG',
    'JPM', 'BRK-B', 'CME', 'ICE', 'SPGI', 'MCO',
    'XOM', 'CVX',
    'GLD', 'TLT',
]


def get_strong_stocks():
    """200일선 위 + 최근 3개월 수익률이 SPY보다 높은 종목을 수익률 순으로 반환"""
    close = download_close(STRONG_POOL + ['SPY'])
    if close.empty or 'SPY' not in close:
        return None
    close = close.ffill()

    def ret(s, n):
        return s.iloc[-1] / s.iloc[-1 - n] - 1 if len(s) > n else np.nan

    spy3 = ret(close['SPY'].dropna(), 63)
    rows = []
    for sym in STRONG_POOL:
        if sym not in close:
            continue
        s = close[sym].dropna()
        if len(s) < 200:
            continue
        r1, r3 = ret(s, 21), ret(s, 63)
        above200 = s.iloc[-1] > s.rolling(200).mean().iloc[-1]
        if above200 and r3 > spy3:
            rows.append((sym, float(s.iloc[-1]), r1, r3))

    rows.sort(key=lambda r: r[3], reverse=True)
    out = []
    for sym, price, r1, r3 in rows[:STRONG_TOP_N]:
        out.append(f"<a href='https://finviz.com/quote.ashx?t={sym}'>{sym}</a>  3개월 {pct(r3)}")
    return out


def load_universe():
    """S&P500 전체 + 관심종목(ETF 제외). 위키 조회 실패 시 관심종목만 사용"""
    base = [t for t in ticker_map if t not in ETF_SET]
    try:
        r = requests.get("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
                         headers=UA, timeout=15)
        df = pd.read_html(io.StringIO(r.text))[0]
        sp = [s.replace('.', '-') for s in df['Symbol'].astype(str).tolist()]
        return sorted(set(sp) | set(base))
    except Exception as e:
        print(f"S&P500 목록 조회 실패, 관심종목만 사용: {e}")
        return base


def get_value_picks(universe):
    """(표시용 리스트, 조건 통과 총 종목 수) 반환. 실패 시 (None, 0)"""
    close = download_close(universe)
    if close.empty:
        return None, 0
    close = close.ffill()
    last = close.iloc[-1]
    dd = last / close.max() - 1

    cands = dd[dd <= -MIN_DRAWDOWN].sort_values().index.tolist()
    if MAX_PRICE:
        cands = [s for s in cands if last[s] <= MAX_PRICE]
    cands = cands[:150]
    print(f"저평가 1차 후보(52주 고점 대비 -{MIN_DRAWDOWN * 100:.0f}% 이상): {len(cands)}종목")
    if not cands:
        return [], 0

    with ThreadPoolExecutor(max_workers=8) as ex:
        infos = list(ex.map(fetch_info, cands))

    rows = []
    for sym, info in infos:
        if not info:
            continue
        fpe, tpe = num(info.get('forwardPE')), num(info.get('trailingPE'))
        fpe = fpe if fpe and fpe > 0 else None
        tpe = tpe if tpe and tpe > 0 else None
        pe = fpe or tpe
        if pe is None or pe > PE_MAX:
            continue
        if MIN_PE and pe < MIN_PE:
            continue
        de = num(info.get('debtToEquity'))
        if MAX_DEBT_TO_EQUITY and de is not None and de > MAX_DEBT_TO_EQUITY:
            continue
        roe = num(info.get('returnOnEquity'))
        if roe is None or roe < MIN_ROE:
            continue
        # 실적 악화 예상(선행PER이 후행PER보다 한참 높음)이면 가치 함정일 가능성이 커서 제외
        if fpe and tpe and fpe > tpe * 1.1:
            continue
        name = ticker_map.get(sym) or html.escape(str(info.get('shortName', ''))[:14])
        rows.append((pe, sym, name, float(last[sym]), float(dd[sym]), roe, 'f' if fpe else 't'))

    rows.sort(key=lambda r: r[0])
    print(f"저평가 최종 통과: {len(rows)}종목")
    out = []
    for pe, sym, name, price, d, roe, basis in rows[:VALUE_TOP_N]:
        star = " ★" if d <= -STAR_DRAWDOWN else ""
        out.append(f"<a href='https://finviz.com/quote.ashx?t={sym}'>{sym}</a>{star}")
    return out, len(rows)


def get_insider_buys():
    """관심종목(메이저/AI 위주)에 해당하는 내부자 매수만. 없으면 None"""
    try:
        url = "http://openinsider.com/top-insider-purchases-of-the-week"
        res = requests.get(url, headers=UA, timeout=15)
        dfs = pd.read_html(io.StringIO(res.text))
        df = next((d for d in dfs if 'Ticker' in d.columns and 'Value' in d.columns), None)
        if df is None or df.empty:
            return None

        df.columns = [str(c).replace('\xa0', ' ').strip() for c in df.columns]
        title_col = next((c for c in df.columns if 'title' in c.lower()), None)
        value_col = next((c for c in df.columns if 'value' in c.lower()), None)
        if not title_col or not value_col:
            return None

        df = df[df['Ticker'].isin(ticker_map.keys())]
        report = []
        for _, row in df.head(5).iterrows():
            t = row['Ticker']
            report.append(f"{ticker_map[t]}({t}): {row[title_col]} / {row[value_col]} 매수")
        return report or None
    except Exception as e:
        print(f"내부자 매수 스크래핑 에러: {e}")
        return None


# ==========================================
# 5. 관심종목, 주봉 하이킨아시, 실적
# ==========================================
ticker_map = {
    'QQQ': '나스닥100', 'TQQQ': '나스닥3배', 'QLD': '나스닥2배', 'SPY': 'S&P500', 'SSO': 'S&P500 2배',
    'SOXL': '반도체3배', 'SOXX': '반도체ETF', 'SMH': '반도체ETF(SMH)',
    'TLT': '미국채20년', 'TMF': '미국채3배',
    'AAPL': '애플', 'MSFT': '마소', 'GOOGL': '알파벳', 'GOOG': '알파벳C',
    'AMZN': '아마존', 'META': '메타', 'TSLA': '테슬라', 'NFLX': '넷플릭스',
    'UBER': '우버', 'DASH': '도어대시', 'ABNB': '에어비앤비', 'SHOP': '쇼피파이',
    'NVDA': '엔비디아', 'TSM': 'TSMC', 'AVGO': '브로드컴', 'ASML': 'ASML', 'AMD': 'AMD',
    'MU': '마이크론', 'QCOM': '퀄컴', 'ARM': 'ARM', 'INTC': '인텔', 'SMCI': '슈퍼마이크로',
    'LRCX': '램리서치', 'AMAT': '어플라이드', 'KLAC': 'KLA', 'TXN': '텍사스인스트루먼츠',
    'ADI': '애널로그디바이시스', 'NXPI': 'NXP세미컨덕터스', 'MCHP': '마이크로칩',
    'MPWR': '모놀리식파워', 'WDC': '웨스턴디지털', 'STX': '시게이트', 'MRVL': '마블',
    'GLW': '코닝', 'DELL': '델', 'IONQ': '아이온큐', 'SNDK': '샌디스크',
    'PLTR': '팔란티어', 'ORCL': '오라클', 'CRWD': '크라우드', 'ANET': '아리스타',
    'CSCO': '시스코시스템즈', 'APP': '앱러빈', 'PANW': '팰로앨토', 'SNPS': '시놉시스',
    'CDNS': '케이던스', 'DDOG': '데이터도그', 'CTSH': '코그니전트', 'ADBE': '어도비',
    'CRM': '세일즈포스', 'NOW': '서비스나우', 'INTU': '인튜이트',
    'ZS': '지스케일러', 'NET': '클라우드플레어', 'CETX': '셈트렉스',
    'XOM': '엑슨모빌', 'CVX': '셰브론', 'SHEL': '쉘', 'OXY': '옥시덴탈',
    'COP': '코노코필립스', 'SLB': '슐룸베르거', 'HAL': '할리버튼', 'BKR': '베이커휴즈',
    'FANG': '다이아몬드백', 'VST': '비스트라', 'CEG': '컨스텔레이션', 'TLN': '탈렌에너지',
    'CCJ': '카메코', 'GEV': 'GE버노바', 'NEE': '넥스트에라', 'DUK': '듀크에너지',
    'MSTR': 'MSTR', 'COIN': '코인베이스', 'HOOD': '로빈후드',
    'LLY': '일라이릴리', 'NVO': '노보노디스크', 'AZN': '아스트라제네카', 'GILD': '길리어드',
    'REGN': '리제네론', 'IDXX': '아이덱스', 'GEHC': 'GE헬스케어', 'INSM': '인스메드',
    'UNH': '유나이티드헬스', 'JNJ': '존슨앤존슨', 'MRK': '머크', 'ABBV': '애브비',
    'V': '비자', 'MA': '마스터카드', 'JPM': 'JP모건', 'BAC': '뱅크오브아메리카',
    'WMT': '월마트', 'COST': '코스트코', 'MAR': '메리어트', 'MNST': '몬스터베버리지',
    'WBD': '워너브로스', 'CSX': 'CSX', 'PCAR': '파카', 'ROST': '로스스토어스',
    'EA': '일렉트로닉아츠', 'TTWO': '테이크투', 'AXON': '액손엔터프라이즈',
    'FER': '페로비알', 'ALNY': '앨나일램', 'ODFL': '올드도미니언',
    # 강세 우량주 후보군 이름 (한글명 표시용)
    'PG': 'P&G', 'KO': '코카콜라', 'PEP': '펩시코', 'MCD': '맥도날드', 'AXP': '아멕스',
    'TJX': 'TJX', 'MDLZ': '몬델리즈', 'CL': '콜게이트', 'ABT': '애보트', 'TMO': '써모피셔',
    'SO': '서던컴퍼니', 'BRK-B': '버크셔B', 'CME': 'CME그룹', 'ICE': 'ICE',
    'SPGI': 'S&P글로벌', 'MCO': '무디스', 'PYPL': '페이팔', 'GLD': '금ETF(GLD)',
}
ticker_map = {k: html.escape(v) for k, v in ticker_map.items()}
ETF_SET = {'QQQ', 'TQQQ', 'QLD', 'SPY', 'SSO', 'SOXL', 'SOXX', 'SMH', 'TLT', 'TMF', 'GLD'}
# 위 확장으로 관심종목(ticker_map)이 늘어났으므로 내부자 매수/주봉 분석은 원래 목록만 사용
WATCHLIST_EXCLUDE = {'PG', 'KO', 'PEP', 'MCD', 'AXP', 'TJX', 'MDLZ', 'CL', 'ABT', 'TMO',
                     'SO', 'BRK-B', 'CME', 'ICE', 'SPGI', 'MCO', 'PYPL', 'GLD'}
tickers = [t for t in ticker_map if t not in WATCHLIST_EXCLUDE]

ha_turn_list = []
weekly_fail_count = 0

if is_monday:
    for symbol in tickers:
        try:
            df_w = yf.download(symbol, period='2y', interval='1wk', progress=False)
            if df_w.empty:
                continue
            df_w.columns = df_w.columns.get_level_values(0) if isinstance(df_w.columns, pd.MultiIndex) else df_w.columns

            ha_c = (df_w['Open'] + df_w['High'] + df_w['Low'] + df_w['Close']) / 4
            ha_o = np.zeros(len(ha_c))
            ha_o[0] = (df_w['Open'].iloc[0] + df_w['Close'].iloc[0]) / 2
            for i in range(1, len(ha_c)):
                ha_o[i] = (ha_o[i - 1] + ha_c.iloc[i - 1]) / 2
            if ha_c.iloc[-2] < ha_o[-2] and ha_c.iloc[-1] > ha_o[-1]:
                ha_turn_list.append(f"{ticker_map[symbol]}({symbol})")
        except Exception as e:
            print(f"주봉 조회 실패 ({symbol}): {e}")
            weekly_fail_count += 1

earnings_lines = []
if finnhub_token:
    try:
        url = f"https://finnhub.io/api/v1/calendar/earnings?from={today}&to={today}&token={finnhub_token}"
        data = requests.get(url, timeout=10).json()
        syms = sorted({it.get('symbol') for it in data.get('earningsCalendar', [])
                       if it.get('symbol') in tickers})
        caps = {sy: market_cap(sy) for sy in syms}
        syms.sort(key=lambda sy: caps[sy], reverse=True)       # 시가총액 큰 순 = 중요한 순
        for sy in syms[:EARNINGS_TOP_N]:
            nm = ticker_map[sy]
            earnings_lines.append(sy if nm == sy else f"{nm}({sy})")
        if len(syms) > EARNINGS_TOP_N:
            earnings_lines.append(f"외 {len(syms) - EARNINGS_TOP_N}개")
    except Exception as e:
        print(f"실적 일정 조회 실패: {e}")

# ==========================================
# 6. 리포트 생성 및 전송 (토큰이 없으면 화면에 출력만 함)
# ==========================================
fg = fetch_fear_greed()
sentiment, streak_txt, fear_txt = "확인 불가", "", ""
stats = None
if fg:
    fg_score, fg_rating, fg_hist = fg
    sentiment = f"{fg_score} ({FG_KOR.get(fg_rating.lower(), fg_rating)})"
    try:
        stats = fear_streak_stats(fg_hist, fg_score < FG_FEAR_MAX)
        if stats:
            streak_txt = f" · 공포 {stats[0]}일째"
            fear_txt = fear_stats_text(stats) + "\n"
        elif fg_score < FG_FEAR_MAX:
            fear_txt = "공포 지속 통계: 조회 실패 (로그 확인)\n"
    except Exception as e:
        print(f"공포 구간 통계 에러: {e}")
        fear_txt = "공포 지속 통계: 조회 실패 (로그 확인)\n"
macro_text, macro_score = get_macro_snapshot()
strong = get_strong_stocks()
value_picks, value_total = get_value_picks(load_universe())
insider = get_insider_buys()

FAIL = "데이터를 가져오지 못했습니다"
NONE = "조건 부합 종목 없음"


def section(title, body):
    return f"<b>{title}</b>\n{body}\n\n"


report = f"<b>시장 심리</b> {sentiment}{streak_txt}\n{fear_txt}\n"
report += section("거시경제", macro_text or FAIL)

report += section("경기 방어주", FAIL if strong is None else ("\n".join(strong) or NONE))

report += section("저평가 후보", FAIL if value_picks is None else ("\n".join(value_picks) or NONE))

if insider:
    report += section("관심종목 내부자 매수", "\n".join(insider))

if is_monday:
    body = ", ".join(ha_turn_list) if ha_turn_list else NONE
    if weekly_fail_count > 0:
        body += f"\n(조회 실패 {weekly_fail_count}종목 제외)"
    report += section("주봉 하이킨아시 양봉 전환", body)

report += section("오늘 실적 발표", "\n".join(earnings_lines) if earnings_lines else "일정 없음")

send_message(report.strip())
print("리포트 계산 완료 (일부 섹션 실패해도 나머지는 계속 진행됨)")


# ==========================================
# 7. 웹앱용 report.json 저장
# ==========================================
def _plain(s):
    return html.unescape(re.sub(r"<[^>]+>", "", str(s))).strip()


def _f(v):
    try:
        v = float(v)
        return round(v, 4) if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


web = {"updated": datetime.now(ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds')}

# 시장 심리
web["sentiment"] = ({"score": fg_score, "rating": fg_rating,
                     "label": FG_KOR.get(fg_rating.lower(), fg_rating)} if fg else None)

# 공포 N일째 + 과거 통계 (공포 구간이 아니면 None)
if stats:
    _cur, _res, _base = stats
    web["fearStats"] = {
        "streak": _cur,
        "results": {str(h): {"mean": _f(_res[h][0]), "win": _f(_res[h][1]), "n": int(_res[h][2])} for h in FWD_DAYS},
        "base": {str(h): {"mean": _f(_base[h][0]), "win": _f(_base[h][1])} for h in FWD_DAYS},
        "text": fear_stats_text(stats),
    }
else:
    web["fearStats"] = None

web["macro"] = {"lines": macro_text.split("\n"), "score": macro_score} if macro_text else None

web["strong"] = (None if strong is None else
                 [{"symbol": _plain(s).split()[0], "text": _plain(s)} for s in strong])

web["value"] = (None if value_picks is None else
                {"total": value_total,
                 "items": [{"symbol": _plain(s).replace("★", "").strip(), "star": "★" in s} for s in value_picks]})

web["insider"] = [_plain(s) for s in insider] if insider else []

web["weeklyHA"] = ({"items": [_plain(s) for s in ha_turn_list], "failed": weekly_fail_count}
                   if is_monday else None)

web["earnings"] = [_plain(s) for s in earnings_lines]

with open("report.json", "w", encoding="utf-8") as fp:
    json.dump(web, fp, ensure_ascii=False, indent=2)
print("report.json 저장 완료")
