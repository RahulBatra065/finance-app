import asyncio
import logging
from datetime import datetime

import httpx
import yfinance as yf
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


async def fetch_mf_nav(client: httpx.AsyncClient, scheme_code: str) -> float | None:
    """Fetch the latest NAV for a mutual fund from mfapi.in."""
    try:
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
        last_price = stock.fast_info.last_price
        return float(last_price) if last_price else None
    except Exception as e:
        logger.error(f"Error fetching stock price for {ticker}: {e}")
    return None


async def refresh_all_prices(db: Session) -> int:
    """
    Refresh current_price for every holding concurrently.
    MF NAVs are fetched in parallel; stock prices run in a thread pool.
    Returns the number of holdings successfully updated.
    """
    from models import Holding

    holdings = db.query(Holding).all()
    if not holdings:
        return 0

    mf_holdings = [h for h in holdings if (h.type or "").lower().replace(" ", "_") == "mutual_fund" and h.scheme_code]
    stock_holdings = [h for h in holdings if (h.type or "").lower().replace(" ", "_") == "stock" and h.ticker]

    # Fetch all MF NAVs concurrently
    async with httpx.AsyncClient(timeout=10) as client:
        mf_prices = await asyncio.gather(
            *[fetch_mf_nav(client, h.scheme_code) for h in mf_holdings],
            return_exceptions=True,
        )

    # Fetch stock prices concurrently in thread pool (yfinance is sync)
    loop = asyncio.get_event_loop()
    stock_prices = await asyncio.gather(
        *[loop.run_in_executor(None, fetch_stock_price, h.ticker) for h in stock_holdings],
        return_exceptions=True,
    )

    updated = 0
    now = datetime.utcnow()

    for holding, price in zip(mf_holdings, mf_prices):
        if isinstance(price, float):
            holding.current_price = price
            holding.last_updated = now
            updated += 1

    for holding, price in zip(stock_holdings, stock_prices):
        if isinstance(price, float):
            holding.current_price = price
            holding.last_updated = now
            updated += 1

    db.commit()
    logger.info(f"Price refresh complete: updated {updated}/{len(holdings)} holdings")
    return updated
