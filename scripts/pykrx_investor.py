"""
pykrx 기반 전체 시장 투자자별 순매수/순매도 상위 종목 조회
Usage: python pykrx_investor.py '{"market":"KOSPI","investor":"외국인","top_n":20}'
"""
import os, sys, json, io
from datetime import datetime, timedelta

# Windows 터미널 인코딩 강제 UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def recent_trading_date():
    """최근 영업일 (주말 건너뜀, 장 마감 16:00 KST 이전이면 전일 사용)"""
    # UTC+9 = KST
    kst_now = datetime.utcnow() + timedelta(hours=9)
    d = kst_now
    # pykrx 당일 데이터는 장 마감(16:00) 후에 확정되므로 그 전이면 전일 사용
    if d.hour < 16:
        d -= timedelta(days=1)
    while d.weekday() >= 5:  # 토=5, 일=6
        d -= timedelta(days=1)
    return d.strftime("%Y%m%d")


def main():
    raw = os.environ.get("PYKRX_PARAMS") or (sys.argv[1] if len(sys.argv) > 1 else "{}")
    params = json.loads(raw)

    from pykrx import stock
    import pandas as pd

    mode = params.get("type", "ranking")  # "ranking" | "stockinvestor"

    # ── 종목별 투자자 시계열 (세부 기관 포함) ─────────────────────────────────
    if mode == "stockinvestor":
        ticker = params.get("ticker", "069500")
        days   = int(params.get("days", 40))  # 달력일 기준 (영업일 약 20일 확보)

        end_dt   = datetime.today()
        while end_dt.weekday() >= 5:
            end_dt -= timedelta(days=1)
        start_dt = end_dt - timedelta(days=days)

        end_str   = end_dt.strftime("%Y%m%d")
        start_str = start_dt.strftime("%Y%m%d")

        df = stock.get_market_trading_value_by_investor(start_str, end_str, ticker)

        if df is None or df.empty:
            print(json.dumps({"ok": True, "ticker": ticker, "data": [], "columns": []}, ensure_ascii=False))
            return

        cols = list(df.columns)
        rows = []
        for idx, row in df.iterrows():
            # idx가 str("2026-06-19") 또는 Timestamp 모두 처리
            try:
                date_str = idx.strftime("%Y%m%d")
            except AttributeError:
                date_str = str(idx).replace("-", "")[:8]
            entry = {"date": date_str}
            for col in cols:
                v = row[col]
                entry[col] = int(v) if not pd.isna(v) else 0
            rows.append(entry)

        print(json.dumps({
            "ok":      True,
            "ticker":  ticker,
            "columns": cols,
            "data":    rows,
        }, ensure_ascii=False))
        return

    # ── 시장 전체 투자자별 순매수 상위 종목 (기존) ────────────────────────────
    market   = params.get("market",   "KOSPI")
    investor = params.get("investor", "외국인")
    date     = params.get("date",     recent_trading_date())
    top_n    = int(params.get("top_n", 20))

    df = stock.get_market_net_purchases_of_equities(date, date, market, investor)

    if df is None or df.empty:
        print(json.dumps({"ok": True, "date": date, "data": [], "count": 0}, ensure_ascii=False))
        return

    cols     = list(df.columns)
    name_col = cols[0]
    qty_col  = cols[3]
    amt_col  = cols[6]

    rows = []
    for ticker, row in df.iterrows():
        try:
            rows.append({
                "ticker":  str(ticker),
                "name":    str(row[name_col]),
                "net_qty": int(row[qty_col]),
                "net_amt": int(row[amt_col]),
            })
        except Exception:
            pass

    buy_top  = rows[:top_n]
    sell_top = sorted(rows, key=lambda x: x["net_amt"])[:top_n]

    print(json.dumps({
        "ok":       True,
        "date":     date,
        "market":   market,
        "investor": investor,
        "count":    len(rows),
        "buy_top":  buy_top,
        "sell_top": sell_top,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
