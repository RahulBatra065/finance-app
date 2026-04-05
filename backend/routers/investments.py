import uuid
from datetime import datetime, date
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
from models import Holding
from routers.auth import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class HoldingCreate(BaseModel):
    name: str
    type: str  # mutual_fund | stock
    units_or_shares: float
    average_buy_price: float
    buy_date: str  # YYYY-MM-DD
    notes: Optional[str] = None
    scheme_code: Optional[str] = None
    ticker: Optional[str] = None


class HoldingUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    units_or_shares: Optional[float] = None
    average_buy_price: Optional[float] = None
    buy_date: Optional[str] = None
    notes: Optional[str] = None
    scheme_code: Optional[str] = None
    ticker: Optional[str] = None
    current_price: Optional[float] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_holding(h: Holding) -> dict:
    invested = h.units_or_shares * h.average_buy_price
    current_value = (
        h.units_or_shares * h.current_price if h.current_price is not None else invested
    )
    pnl = current_value - invested
    pnl_pct = (pnl / invested * 100) if invested else 0.0

    try:
        buy_dt = datetime.strptime(h.buy_date, "%Y-%m-%d").date()
        days_held = (date.today() - buy_dt).days
    except Exception:
        days_held = 0

    return {
        "id": h.id,
        "name": h.name,
        "type": h.type,
        "units_or_shares": h.units_or_shares,
        "average_buy_price": h.average_buy_price,
        "buy_date": h.buy_date,
        "notes": h.notes,
        "scheme_code": h.scheme_code,
        "ticker": h.ticker,
        "current_price": h.current_price,
        "last_updated": h.last_updated.isoformat() if h.last_updated else None,
        "invested_value": round(invested, 2),
        "current_value": round(current_value, 2),
        "pnl": round(pnl, 2),
        "pnl_pct": round(pnl_pct, 2),
        "days_held": days_held,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/holdings")
def list_holdings(
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    holdings = db.query(Holding).all()
    return [_compute_holding(h) for h in holdings]


@router.post("/holdings", status_code=201)
def create_holding(
    body: HoldingCreate,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    holding = Holding(
        id=str(uuid.uuid4()),
        name=body.name,
        type=body.type,
        units_or_shares=body.units_or_shares,
        average_buy_price=body.average_buy_price,
        buy_date=body.buy_date,
        notes=body.notes,
        scheme_code=body.scheme_code,
        ticker=body.ticker,
    )
    db.add(holding)
    db.commit()
    db.refresh(holding)
    return _compute_holding(holding)


@router.put("/holdings/{holding_id}")
def update_holding(
    holding_id: str,
    body: HoldingUpdate,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    holding = db.query(Holding).filter(Holding.id == holding_id).first()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")

    for field, value in body.dict(exclude_none=True).items():
        setattr(holding, field, value)

    db.commit()
    db.refresh(holding)
    return _compute_holding(holding)


@router.delete("/holdings/{holding_id}", status_code=204)
def delete_holding(
    holding_id: str,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    holding = db.query(Holding).filter(Holding.id == holding_id).first()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")
    db.delete(holding)
    db.commit()


@router.get("/dashboard")
def investment_dashboard(
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    holdings = db.query(Holding).all()
    if not holdings:
        return {
            "total_invested": 0,
            "total_current": 0,
            "overall_pnl": 0,
            "overall_pnl_pct": 0,
            "last_refresh": None,
            "holdings": [],
        }

    computed = [_compute_holding(h) for h in holdings]
    total_invested = sum(c["invested_value"] for c in computed)
    total_current = sum(c["current_value"] for c in computed)
    overall_pnl = total_current - total_invested
    overall_pnl_pct = (overall_pnl / total_invested * 100) if total_invested else 0.0

    last_refresh = max(
        (h.last_updated for h in holdings if h.last_updated),
        default=None,
    )

    # Add allocation percentage
    for c in computed:
        c["allocation_pct"] = (
            round(c["current_value"] / total_current * 100, 2) if total_current else 0.0
        )

    return {
        "total_invested": round(total_invested, 2),
        "total_current": round(total_current, 2),
        "overall_pnl": round(overall_pnl, 2),
        "overall_pnl_pct": round(overall_pnl_pct, 2),
        "last_refresh": last_refresh.isoformat() if last_refresh else None,
        "holdings": computed,
    }


@router.get("/search-mf")
async def search_mf(
    q: str = Query(..., description="Fund name search query"),
    _user: str = Depends(get_current_user),
):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://api.mfapi.in/mf/search", params={"q": q}
            )
            raw = response.json()
            # mfapi returns camelCase; normalise to snake_case for the frontend
            results = [
                {
                    "scheme_code": str(f.get("schemeCode") or f.get("scheme_code", "")),
                    "scheme_name": f.get("schemeName") or f.get("scheme_name") or f.get("name", ""),
                }
                for f in (raw if isinstance(raw, list) else [])
            ]
            return results
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Error contacting mfapi.in: {e}")


@router.post("/refresh-prices")
async def refresh_prices(
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    from services.price_fetcher import refresh_all_prices

    updated = await refresh_all_prices(db)
    return {"updated": updated, "refreshed_at": datetime.utcnow().isoformat()}
