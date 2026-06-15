import sys
sys.stdout.reconfigure(encoding='utf-8')

import yfinance as yf
import json
import threading
import pandas as pd
import numpy as np

# ==========================================
# 국내 KODEX ETF 29종목 데이터 수집 스크립트
# 실행 후 etf_domestic_b1.json, etf_domestic_b2.json 생성
#
# 확정 티커 (Yahoo Finance):
#   069500.KS = KODEX 200
#   229200.KS = KODEX 코스닥150
#   091160.KS = KODEX 반도체
#   305720.KS = KODEX 2차전지산업
#   091180.KS = KODEX 자동차
#   441680.KS = KODEX K-신재생에너지액티브
#   143460.KS = KODEX 바이오
#   445290.KS = KODEX 로봇액티브
#   472870.KS = KODEX 방산TOP10
#   0098F0.KS = KODEX 원자력SMR
#   449170.KS = KODEX 자율주행액티브
#   488290.KS = KODEX 조선TOP10
#   475080.KS = KODEX AI전력핵심설비
#   104530.KS = KODEX 건설
#   228810.KS = KODEX 경기소비재
#   228820.KS = KODEX 기계장비
#   091170.KS = KODEX 금융
#   117460.KS = KODEX 에너지화학
#   140710.KS = KODEX 운송
#   117680.KS = KODEX 철강
#   228800.KS = KODEX 필수소비재
#   114820.KS = KODEX 국고채3년
#   471230.KS = KODEX 국고채10년액티브
#   132030.KS = KODEX 골드선물(H)
#   138920.KS = KODEX 구리선물(H)
#   261220.KS = KODEX WTI원유선물(H)
#   459580.KS = KODEX CD금리액티브(합성)
#   453850.KS = KODEX 미국채30년액티브(H)
#   138230.KS = KODEX 미국달러선물
# ==========================================

period = "3y"

# Batch 1 (15종목)
B1 = "069500.KS,229200.KS,091160.KS,305720.KS,091180.KS,441680.KS,143460.KS,445290.KS,472870.KS,0098F0.KS,449170.KS,488290.KS,475080.KS,104530.KS,228810.KS"

# Batch 2 (14종목)
B2 = "228820.KS,091170.KS,117460.KS,140710.KS,117680.KS,228800.KS,114820.KS,471230.KS,132030.KS,138920.KS,261220.KS,459580.KS,453850.KS,138230.KS"


def fetch_batch(tickers, current_period, outfile):
    try:
        raw = yf.download(tickers, period=current_period, auto_adjust=True, progress=False)
        if raw is None or raw.empty:
            print(f"  ⚠️ {outfile}: 데이터 없음")
            return False

        close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw[["Close"]]
        if isinstance(close, pd.Series):
            close = close.to_frame(name=tickers[0])
        close.columns = [str(c).upper() for c in close.columns]

        # 실제 데이터가 있는 티커만 필터링 (NaN 전체인 컬럼 제외)
        available = [
            t for t in tickers
            if t.upper() in close.columns and close[t.upper()].notna().any()
        ]
        if not available:
            print(f"  ⚠️ {outfile}: 사용 가능한 티커 없음")
            return False
        if len(available) < len(tickers):
            missing = [t for t in tickers if t not in available]
            print(f"  ⚠️ 누락된 티커: {missing}")

        # 사용 가능한 티커만 선택 후 ffill, 공통 날짜로 제한
        close = close[available].ffill()

        # 각 컬럼의 첫 유효 날짜 이후부터만 사용 (신규 상장 ETF 대응)
        first_valid = max(close[t.upper()].first_valid_index() for t in available)
        close = close.loc[first_valid:].dropna()

        if close.empty:
            print(f"  ⚠️ {outfile}: ffill 후 데이터 없음")
            return False

        dates = [str(d.date()) for d in close.index]
        prices = {
            t: [round(float(v), 2) if not np.isnan(v) else None for v in close[t.upper()]]
            for t in available
        }

        result = {
            "tickers": available,
            "period": current_period,
            "start": dates[0],
            "end": dates[-1],
            "trading_days": len(dates),
            "dates": dates,
            "prices": prices,
        }
        with open(outfile, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
        print(f"  ✅ {outfile} 저장 완료 ({len(available)}종목, {len(dates)}거래일)")
        return True
    except Exception as e:
        import traceback
        print(f"  ❌ {outfile} 오류: {e}")
        traceback.print_exc()
        return False


t1 = [t.strip() for t in B1.split(",")]
t2 = [t.strip() for t in B2.split(",")]

file_b1 = "./etf_domestic_b1.json"
file_b2 = "./etf_domestic_b2.json"

print("=" * 60)
print("국내 KODEX ETF 29종목 데이터 수집 시작")
print("=" * 60)
print("\n데이터 로딩 중 (병렬)...")

th1 = threading.Thread(target=fetch_batch, args=(t1, period, file_b1))
th2 = threading.Thread(target=fetch_batch, args=(t2, period, file_b2))
th1.start()
th2.start()
th1.join()
th2.join()

print("\n완료! etf_domestic_b1.json, etf_domestic_b2.json 생성됨")
