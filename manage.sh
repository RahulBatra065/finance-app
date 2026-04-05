#!/bin/bash
# manage.sh — start / stop / restart / status the finance app
# Works over SSH: run it and exit the session, app keeps running.
#
# Usage:
#   ./manage.sh start
#   ./manage.sh stop
#   ./manage.sh restart
#   ./manage.sh status
#   ./manage.sh logs        (tail live logs)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV="$APP_DIR/venv/bin/activate"
LOG_DIR="$HOME/finance-app/logs"
PID_FILE="$LOG_DIR/finance-app.pid"
LOG_FILE="$LOG_DIR/uvicorn.log"
ERR_FILE="$LOG_DIR/uvicorn-error.log"

mkdir -p "$LOG_DIR"

# ── helpers ─────────────────────────────────────────────────────────────────

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

do_build() {
  echo "Building frontend..."
  cd "$FRONTEND_DIR"
  npm run build
  echo "Frontend built."
}

do_start() {
  if is_running; then
    echo "Already running (PID $(cat "$PID_FILE"))."
    exit 0
  fi

  do_build

  echo "Starting finance app..."
  cd "$APP_DIR"
  source "$VENV"

  # nohup + disown keeps the process alive after SSH session ends
  nohup uvicorn main:app \
    --host 0.0.0.0 \
    --port 8000 \
    >> "$LOG_FILE" 2>> "$ERR_FILE" &

  echo $! > "$PID_FILE"
  disown

  sleep 1
  if is_running; then
    echo "Started  (PID $(cat "$PID_FILE"))"
    echo "Logs     : $LOG_FILE"
    echo "Errors   : $ERR_FILE"
  else
    echo "ERROR: process died immediately. Check $ERR_FILE"
    cat "$ERR_FILE" | tail -20
    exit 1
  fi
}

do_stop() {
  if ! is_running; then
    echo "Not running."
    return
  fi
  PID=$(cat "$PID_FILE")
  echo "Stopping PID $PID..."
  kill "$PID"
  rm -f "$PID_FILE"
  echo "Stopped."
}

do_status() {
  if is_running; then
    PID=$(cat "$PID_FILE")
    echo "RUNNING  (PID $PID)"
    echo "Port     : 8000"
    echo "Log      : $LOG_FILE"
    # Show last 5 log lines
    echo ""
    echo "--- last 5 log lines ---"
    tail -5 "$LOG_FILE" 2>/dev/null || echo "(no log yet)"
  else
    echo "STOPPED"
  fi
}

do_logs() {
  echo "Tailing $LOG_FILE  (Ctrl+C to stop)"
  tail -f "$LOG_FILE"
}

do_portfolio() {
  echo "Refreshing prices and sending Telegram update..."
  cd "$APP_DIR"
  source "$VENV"
  python -c "
import asyncio, os, httpx
from dotenv import load_dotenv
load_dotenv()
from database import SessionLocal
from models import Holding
from services.price_fetcher import refresh_all_prices

async def run():
    db = SessionLocal()
    try:
        count = await refresh_all_prices(db)
        print(f'Updated {count} holdings')
        token = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
        chat_id = os.getenv('TELEGRAM_ALLOWED_USER_ID', '').strip()
        if not token or not chat_id:
            print('ERROR: TELEGRAM_BOT_TOKEN or TELEGRAM_ALLOWED_USER_ID not set')
            return
        holdings = db.query(Holding).all()
        total_invested = sum(h.units_or_shares * h.average_buy_price for h in holdings)
        total_current = sum(
            h.units_or_shares * h.current_price if h.current_price is not None
            else h.units_or_shares * h.average_buy_price
            for h in holdings
        )
        pnl = total_current - total_invested
        pnl_pct = (pnl / total_invested * 100) if total_invested else 0.0
        pnl_sign = '+' if pnl >= 0 else ''
        lines = ['📈 *Portfolio Snapshot*\n']
        for h in sorted(holdings, key=lambda x: x.name):
            if h.current_price is None:
                continue
            invested = h.units_or_shares * h.average_buy_price
            current = h.units_or_shares * h.current_price
            gain = current - invested
            gain_sign = '+' if gain >= 0 else ''
            lines.append(f'• {h.name}: ₹{current:,.0f} ({gain_sign}₹{gain:,.0f})')
        lines.append(f'\n💼 Total: ₹{total_current:,.0f} | P&L: {pnl_sign}₹{pnl:,.0f} ({pnl_sign}{pnl_pct:.1f}%)')
        from models import SplitExpense
        pending = db.query(SplitExpense).filter(SplitExpense.status != 'settled').all()
        if pending:
            total_owed = sum(s.amount_owed - s.amount_received for s in pending)
            lines.append(f'\n💸 *Pending Splits*: ₹{total_owed:,.0f} across {len(pending)} expense(s)')
        from models import Transaction as Txn
        from datetime import date as dt
        today_d = dt.today()
        amortised_txns = db.query(Txn).filter(Txn.direction == 'debit', Txn.amortise_months.isnot(None)).all()
        active = []
        for t in amortised_txns:
            txn_date = dt.fromisoformat(t.date)
            months_elapsed = (today_d.year - txn_date.year) * 12 + (today_d.month - txn_date.month)
            months_left = t.amortise_months - months_elapsed
            if months_left > 0:
                active.append((t.vendor, round(t.amount / t.amortise_months, 0), months_left))
        if active:
            lines.append('\n📅 *Amortised Expenses*:')
            for vendor, monthly, left in sorted(active, key=lambda x: x[2]):
                lines.append(f'  • {vendor}: ₹{monthly:,.0f}/month · {left} month{"s" if left != 1 else ""} left')
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f'https://api.telegram.org/bot{token}/sendMessage',
                json={'chat_id': chat_id, 'text': chr(10).join(lines), 'parse_mode': 'Markdown'},
            )
        print('Telegram update sent.')
    finally:
        db.close()

asyncio.run(run())
"
}

# ── dispatch ─────────────────────────────────────────────────────────────────

case "${1:-help}" in
  start)     do_start   ;;
  stop)      do_stop    ;;
  restart)   do_stop; sleep 1; do_start ;;
  status)    do_status  ;;
  logs)      do_logs    ;;
  portfolio) do_portfolio ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|portfolio}"
    exit 1
    ;;
esac
