import argparse
import json
import os
import re
import sys
import traceback

PROD_ROOT = r"C:\Users\kaniampurath\mytradingmind.ai\myts_prod_local"


def emit(payload):
    if isinstance(payload, dict):
        payload = redact_payload(payload)
    print(json.dumps(payload, default=str), flush=True)


def redact_payload(payload):
    redacted = {}
    for key, value in payload.items():
        if isinstance(value, str):
            redacted[key] = redact_text(value)
        elif isinstance(value, dict):
            redacted[key] = redact_payload(value)
        else:
            redacted[key] = value
    return redacted


def redact_text(value):
    text = str(value)
    text = re.sub(r"(api_token=)[^&\s]+", r"\1REDACTED", text)
    text = re.sub(r"(api_token%3D)[^%&\s]+", r"\1REDACTED", text)
    return text


def main():
    parser = argparse.ArgumentParser(description="Run one production rs_daily EODHD shard.")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--from-date")
    parser.add_argument("--to-date")
    parser.add_argument("--target-date")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if PROD_ROOT not in sys.path:
        sys.path.insert(0, PROD_ROOT)

    os.chdir(PROD_ROOT)

    import numpy as np
    import pandas as pd
    import utils
    from sqlalchemy import text

    configure_eodhd_ssl(utils)
    install_complete_rs_daily_upsert(utils, np, pd, text)

    emit({
        "type": "started",
        "run_id": args.run_id,
        "range": f"{args.start}-{args.end}",
        "start": args.start,
        "end": args.end,
        "from_date": args.from_date,
        "to_date": args.to_date,
        "target_date": args.target_date,
        "dry_run": args.dry_run,
    })

    universe = utils.fetch_stocks_from_master(args.start, args.end)
    total_symbols = int(len(universe))

    if args.dry_run:
        emit({
            "type": "completed",
            "run_id": args.run_id,
            "range": f"{args.start}-{args.end}",
            "total_symbols": total_symbols,
            "records_inserted": 0,
            "status": "DRY_RUN_VALIDATED",
        })
        return 0

    status = utils.load_marketdata_from_eodh(args.start, args.end)
    run_date = args.target_date or utils.last_completed_nyse_trading_day()

    with utils.get_engine().connect() as conn:
        row = conn.execute(text("""
            SELECT COUNT(*) AS cnt
            FROM rs_daily
            WHERE sdate = :run_date
              AND LEFT(UPPER(stock_symbol), 1) BETWEEN :start_char AND :end_char
        """), {
            "run_date": run_date,
            "start_char": args.start,
            "end_char": args.end,
        }).fetchone()

    emit({
        "type": "completed",
        "run_id": args.run_id,
        "range": f"{args.start}-{args.end}",
        "run_date": run_date,
        "total_symbols": total_symbols,
        "records_inserted": int(row[0] or 0) if row else 0,
        "status": status,
    })
    return 0


def install_complete_rs_daily_upsert(utils, np, pd, text):
    def insert_mysql_complete(df):
        engine = utils.get_engine()
        df = df.copy()
        df.rename(columns={
            "SDate": "sdate",
            "StockSymbol": "stock_symbol",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "AdjClose": "adj_close",
            "Volume": "volume",
        }, inplace=True)

        if "ma50" not in df.columns:
            df["ma50"] = df["close"].ewm(span=50, adjust=False).mean()
        if "avg_volume_50" not in df.columns:
            df["avg_volume_50"] = df["volume"].ewm(span=50, adjust=False).mean()

        df = df.where(pd.notnull(df), None)
        utils.validate_dataframe_for_insert(df)
        numeric_df = df.select_dtypes(include=[np.number])
        if not numeric_df.empty and np.isinf(numeric_df.to_numpy()).any():
            df.replace([np.inf, -np.inf], np.nan, inplace=True)
            df = df.where(pd.notnull(df), None)

        sql = text("""
            INSERT INTO rs_daily (
                sdate, stock_symbol, open, high, low, close, adj_close, volume,
                perf_1d_pct, perf_5d_pct,
                Isdown4_pctd, IsUp4_pctd,
                Isdown25_pctq, IsUp25_pctq,
                rs_val, rs_val_3m,
                spy_pullback_flag, pullback_leader_strength,
                mci, mci_below_threshold,
                sector, industry, ma50, avg_volume_50
            )
            VALUES (
                :sdate, :stock_symbol, :open, :high, :low, :close, :adj_close, :volume,
                :perf_1d_pct, :perf_5d_pct,
                :Isdown4_pctd, :IsUp4_pctd,
                :Isdown25_pctq, :IsUp25_pctq,
                :rs_val, :rs_val_3m,
                :spy_pullback_flag, :pullback_leader_strength,
                :mci, :mci_below_threshold,
                :sector, :industry, :ma50, :avg_volume_50
            )
            ON DUPLICATE KEY UPDATE
                open = VALUES(open),
                high = VALUES(high),
                low = VALUES(low),
                close = VALUES(close),
                adj_close = VALUES(adj_close),
                volume = VALUES(volume),
                perf_1d_pct = VALUES(perf_1d_pct),
                perf_5d_pct = VALUES(perf_5d_pct),
                Isdown4_pctd = VALUES(Isdown4_pctd),
                IsUp4_pctd = VALUES(IsUp4_pctd),
                Isdown25_pctq = VALUES(Isdown25_pctq),
                IsUp25_pctq = VALUES(IsUp25_pctq),
                rs_val = VALUES(rs_val),
                rs_val_3m = VALUES(rs_val_3m),
                spy_pullback_flag = VALUES(spy_pullback_flag),
                pullback_leader_strength = VALUES(pullback_leader_strength),
                mci = VALUES(mci),
                mci_below_threshold = VALUES(mci_below_threshold),
                sector = VALUES(sector),
                industry = VALUES(industry),
                ma50 = VALUES(ma50),
                avg_volume_50 = VALUES(avg_volume_50)
        """)

        records = df.to_dict(orient="records")
        with engine.begin() as conn:
            conn.execute(sql, records)

    utils.insert_mysql = insert_mysql_complete


def configure_eodhd_ssl(utils):
    try:
        import certifi
        import requests
        utils.SESSION.verify = certifi.where()
        try:
            requests.get("https://eodhd.com", timeout=5, verify=certifi.where())
            emit({"type": "ssl", "status": "CERTIFI_CA_BUNDLE"})
        except requests.exceptions.SSLError as exc:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            utils.SESSION.verify = False
            emit({"type": "ssl", "status": "VERIFY_DISABLED_FALLBACK", "error": str(exc)})
    except Exception as exc:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        utils.SESSION.verify = False
        emit({"type": "ssl", "status": "VERIFY_DISABLED", "error": str(exc)})


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        emit({
            "type": "failed",
            "error": str(exc),
            "traceback": traceback.format_exc(limit=8),
        })
        raise
