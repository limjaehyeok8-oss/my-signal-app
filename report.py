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


def
