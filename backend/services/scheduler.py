import logging
from datetime import datetime, timedelta
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = AsyncIOScheduler()


def setup_loggers() -> logging.Logger:
    log_dir = Path("~/finance-app/logs").expanduser()
    log_dir.mkdir(parents=True, exist_ok=True)

    fmt = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")

    scheduler_logger = logging.getLogger("scheduler")
    if not scheduler_logger.handlers:
        sh = logging.FileHandler(log_dir / "scheduler.log")
        sh.setFormatter(fmt)
        scheduler_logger.addHandler(sh)
        scheduler_logger.setLevel(logging.INFO)

    cleanup_logger = logging.getLogger("cleanup")
    if not cleanup_logger.handlers:
        ch = logging.FileHandler(log_dir / "cleanup.log")
        ch.setFormatter(fmt)
        cleanup_logger.addHandler(ch)
        cleanup_logger.setLevel(logging.INFO)

    return scheduler_logger


async def cleanup_old_files():
    """Delete invoice files older than 12 months; DB records are kept."""
    from services.compression import get_storage_path

    logger = logging.getLogger("cleanup")
    cutoff = datetime.utcnow() - timedelta(days=365)
    storage = get_storage_path() / "invoices"

    if not storage.exists():
        logger.info("Storage directory does not exist; skipping cleanup.")
        return

    deleted = 0
    for file_path in storage.rglob("*"):
        if file_path.is_file():
            mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
            if mtime < cutoff:
                try:
                    file_path.unlink()
                    logger.info(f"Deleted old file: {file_path}")
                    deleted += 1
                except Exception as e:
                    logger.error(f"Error deleting {file_path}: {e}")

    logger.info(f"Cleanup complete: deleted {deleted} files")


def start_scheduler(app):  # noqa: ARG001
    """Register scheduled jobs and start the scheduler."""
    logger = setup_loggers()

    # Daily cleanup at 2:00 AM UTC
    scheduler.add_job(cleanup_old_files, CronTrigger(hour=2, minute=0), id="cleanup_old_files", replace_existing=True)

    # Daily price refresh at 9:00 AM IST (3:30 AM UTC) with Telegram summary
    async def refresh_prices_job():
        import os
        import httpx
        from database import SessionLocal
        from models import Holding
        from services.price_fetcher import refresh_all_prices

        db = SessionLocal()
        try:
            count = await refresh_all_prices(db)
            logger.info(f"Scheduled price refresh complete: {count} holdings updated")

            # Send Telegram summary
            token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
            chat_id = os.getenv("TELEGRAM_ALLOWED_USER_ID", "").strip()
            if token and chat_id:
                holdings = db.query(Holding).all()
                total_invested = sum(h.units_or_shares * h.average_buy_price for h in holdings)
                total_current = sum(
                    h.units_or_shares * h.current_price
                    if h.current_price is not None
                    else h.units_or_shares * h.average_buy_price
                    for h in holdings
                )
                pnl = total_current - total_invested
                pnl_pct = (pnl / total_invested * 100) if total_invested else 0.0
                pnl_sign = "+" if pnl >= 0 else ""

                lines = ["📈 *Daily Portfolio Update*\n"]
                for h in sorted(holdings, key=lambda x: x.name):
                    if h.current_price is None:
                        continue
                    invested = h.units_or_shares * h.average_buy_price
                    current = h.units_or_shares * h.current_price
                    gain = current - invested
                    gain_sign = "+" if gain >= 0 else ""
                    lines.append(
                        f"• {h.name}: ₹{current:,.0f} ({gain_sign}₹{gain:,.0f})"
                    )

                lines.append(
                    f"\n💼 Total: ₹{total_current:,.0f} | P&L: {pnl_sign}₹{pnl:,.0f} ({pnl_sign}{pnl_pct:.1f}%)"
                )

                # Pending splits
                from models import SplitExpense
                pending = db.query(SplitExpense).filter(SplitExpense.status != "settled").all()
                if pending:
                    total_owed = sum(s.amount_owed - s.amount_received for s in pending)
                    lines.append(f"\n💸 *Pending Splits*: ₹{total_owed:,.0f} across {len(pending)} expense(s)")

                # Active amortised expenses
                from models import Transaction as Txn
                from datetime import date as dt
                today_d = dt.today()
                amortised_txns = db.query(Txn).filter(
                    Txn.direction == "debit", Txn.amortise_months.isnot(None)
                ).all()
                active = []
                for t in amortised_txns:
                    txn_date = dt.fromisoformat(t.date)
                    months_elapsed = (today_d.year - txn_date.year) * 12 + (today_d.month - txn_date.month)
                    months_left = t.amortise_months - months_elapsed
                    if months_left > 0:
                        active.append((t.vendor, round(t.amount / t.amortise_months, 0), months_left))
                if active:
                    lines.append("\n📅 *Amortised Expenses*:")
                    for vendor, monthly, left in sorted(active, key=lambda x: x[2]):
                        lines.append(f"  • {vendor}: ₹{monthly:,.0f}/month · {left} month{'s' if left != 1 else ''} left")

                message = "\n".join(lines)
                async with httpx.AsyncClient(timeout=10) as client:
                    await client.post(
                        f"https://api.telegram.org/bot{token}/sendMessage",
                        json={"chat_id": chat_id, "text": message, "parse_mode": "Markdown"},
                    )
                logger.info("Telegram portfolio summary sent")
        except Exception as e:
            logger.error(f"Price refresh error: {e}")
        finally:
            db.close()

    scheduler.add_job(refresh_prices_job, CronTrigger(hour=3, minute=30), id="refresh_prices", replace_existing=True)

    scheduler.start()
    logger.info("APScheduler started with cleanup and price-refresh jobs")
