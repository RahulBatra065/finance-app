import logging
from datetime import datetime

import httpx
import yfinance as yf
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


async def fetch_mf_nav(scheme_code: str) -> float | None:
    """Fetch the latest NAV for a mutual fund from mfapi.in."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"https://api.mfapi.in/mf/{scheme_code}")
            data = response.json()
            if data.get("data"):
                return float(data["data"][0]["nav"])
    except Exception as e:
        logger.error(f"Error fetching MF NAV for {scheme_code}: {e}")
    return None


def fetch_stock_price(ticker: str) -> float | None:
    """Fetch the latest price for an NSE-listed stock via yfinance."""
    try:
        nse_ticker = ticker if ticker.endswith(".NS") else f"{ticker}.NS"
        stock = yf.Ticker(nse_ticker)
        info = stock.fast_info
        last_price = info.last_price
        return float(last_price) if last_price else None
    except Exception as e:
        logger.error(f"Error fetching stock price for {ticker}: {e}")
    return None


async def refresh_all_prices(db: Session) -> int:
    """
    Refresh current_price for every holding in the database.

    Returns the number of holdings that were successfully updated.
    """
    from models import Holding  # local import to avoid circular deps

    holdings = db.query(Holding).all()
    updated = 0
    for holding in holdings:
        price = None
        htype = (holding.type or "").lower().replace(" ", "_")
        if htype == "mutual_fund" and holding.scheme_code:
            price = await fetch_mf_nav(holding.scheme_code)
        elif htype == "stock" and holding.ticker:
            price = fetch_stock_price(holding.ticker)

        if price is not None:
            holding.current_price = price
            holding.last_updated = datetime.utcnow()
            updated += 1

    db.commit()
    logger.info(f"Price refresh complete: updated {updated}/{len(holdings)} holdings")
    return updated
