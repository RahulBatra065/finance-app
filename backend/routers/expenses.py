import hashlib
from datetime import datetime, date
from typing import Optional, List

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Category, Transaction, VendorMapping
from routers.auth import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TransactionCreate(BaseModel):
    amount: float
    currency: str = "INR"
    direction: str  # debit / credit
    vendor: str
    bank: Optional[str] = None
    account_last4: Optional[str] = None
    date: str  # YYYY-MM-DD
    upi_ref: Optional[str] = None
    category: str = "Miscellaneous"
    raw_text: Optional[str] = ""
    source_type: str = "manual"
    notes: Optional[str] = None
    payment_method: Optional[str] = None
    amortise_months: Optional[int] = None


class CategoryCreate(BaseModel):
    name: str
    monthly_budget: Optional[float] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    monthly_budget: Optional[float] = None


class VendorMappingCreate(BaseModel):
    keyword: str
    category: str


class PatchCategory(BaseModel):
    category: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _txn_to_dict(t: Transaction) -> dict:
    return {
        "id": t.id,
        "sha256_hash": t.sha256_hash,
        "amount": t.amount,
        "currency": t.currency,
        "direction": t.direction,
        "vendor": t.vendor,
        "bank": t.bank,
        "account_last4": t.account_last4,
        "date": t.date,
        "upi_ref": t.upi_ref,
        "category": t.category,
        "raw_text": t.raw_text,
        "source_type": t.source_type,
        "file_path": t.file_path,
        "notes": t.notes,
        "payment_method": t.payment_method,
        "amortise_months": t.amortise_months,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


def _cat_to_dict(c: Category) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "monthly_budget": c.monthly_budget,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _months_between(d1: date, d2: date) -> int:
    """Number of complete calendar months from d1 to d2 (can be negative)."""
    return (d2.year - d1.year) * 12 + (d2.month - d1.month)


def _amortised_total_out(all_debits: list, period_start: date, period_end: date) -> tuple[float, dict, list]:
    """
    Compute effective total_out, category spend, and active amortised items
    for [period_start, period_end], spreading amortised transactions monthly.

    Returns:
        (total_out, cat_spend_dict, active_amortised_list)
    active_amortised_list items: {vendor, monthly, months_remaining, category}
    """
    total_out = 0.0
    cat_spend: dict = {}
    active_amortised: list = []

    for t in all_debits:
        txn_date = date.fromisoformat(t.date)
        if t.amortise_months and t.amortise_months > 1:
            monthly = t.amount / t.amortise_months
            months_since = _months_between(txn_date, period_start)
            months_remaining = t.amortise_months - _months_between(txn_date, date.today())
            # Active in current period: coverage hasn't ended before period_start
            if 0 <= months_since < t.amortise_months:
                total_out += monthly
                cat = t.category or "Miscellaneous"
                cat_spend[cat] = cat_spend.get(cat, 0.0) + monthly
            if months_remaining > 0:
                active_amortised.append({
                    "vendor": t.vendor,
                    "monthly": round(monthly, 2),
                    "months_remaining": months_remaining,
                    "category": t.category or "Miscellaneous",
                })
        else:
            if period_start.isoformat() <= t.date <= period_end.isoformat():
                total_out += t.amount
                cat = t.category or "Miscellaneous"
                cat_spend[cat] = cat_spend.get(cat, 0.0) + t.amount

    return total_out, cat_spend, active_amortised


def _current_month_range():
    now = datetime.utcnow()
    month_start = f"{now.year}-{now.month:02d}-01"
    month_end = f"{now.year}-{now.month:02d}-31"
    return month_start, month_end


def _pay_period_start(db: Session) -> date:
    """Return the start of the current pay period.

    Looks for the most recent Salary credit.  If found, the pay period starts
    on that date.  Falls back to the first of the calendar month if no salary
    transactions exist yet.
    """
    salary_txn = (
        db.query(Transaction)
        .filter(
            Transaction.direction == "credit",
            Transaction.category == "Salary",
        )
        .order_by(Transaction.date.desc())
        .first()
    )
    today = date.today()
    if salary_txn:
        salary_date = date.fromisoformat(salary_txn.date)
        if salary_date <= today:
            return salary_date
    return today.replace(day=1)


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------

@router.get("/transactions")
def list_transactions(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    vendor: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    q = db.query(Transaction)
    if start_date:
        q = q.filter(Transaction.date >= start_date)
    if end_date:
        q = q.filter(Transaction.date <= end_date)
    if category:
        q = q.filter(Transaction.category == category)
    if vendor:
        q = q.filter(Transaction.vendor.ilike(f"%{vendor}%"))
    if direction:
        q = q.filter(Transaction.direction == direction)

    total = q.count()
    items = (
        q.order_by(Transaction.date.desc(), Transaction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_txn_to_dict(t) for t in items],
    }


@router.post("/transactions", status_code=201)
def create_transaction(
    body: TransactionCreate,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    import hashlib

    content = f"{body.amount}{body.vendor}{body.date}{body.direction}{body.raw_text}"
    sha256 = hashlib.sha256(content.encode()).hexdigest()

    existing = db.query(Transaction).filter(Transaction.sha256_hash == sha256).first()
    if existing:
        raise HTTPException(status_code=409, detail="Duplicate transaction")

    txn = Transaction(
        sha256_hash=sha256,
        amount=body.amount,
        currency=body.currency,
        direction=body.direction,
        vendor=body.vendor,
        bank=body.bank,
        account_last4=body.account_last4,
        date=body.date,
        upi_ref=body.upi_ref,
        category=body.category,
        raw_text=body.raw_text or "",
        source_type=body.source_type,
        notes=body.notes,
        payment_method=body.payment_method,
        amortise_months=body.amortise_months,
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return _txn_to_dict(txn)


class TransactionUpdate(BaseModel):
    amount: Optional[float] = None
    direction: Optional[str] = None
    vendor: Optional[str] = None
    date: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    bank: Optional[str] = None
    account_last4: Optional[str] = None
    upi_ref: Optional[str] = None
    payment_method: Optional[str] = None
    amortise_months: Optional[int] = None


@router.patch("/transactions/{txn_id}")
def update_transaction(
    txn_id: int,
    body: TransactionUpdate,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    txn = db.query(Transaction).filter(Transaction.id == txn_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    # Use exclude_unset so explicitly passed null values (e.g. clearing amortise_months) are applied
    for field, value in body.dict(exclude_unset=True).items():
        setattr(txn, field, value)
    db.commit()
    db.refresh(txn)
    return _txn_to_dict(txn)


@router.patch("/transactions/{txn_id}/category")
def update_transaction_category(
    txn_id: int,
    body: PatchCategory,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    txn = db.query(Transaction).filter(Transaction.id == txn_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    txn.category = body.category
    db.commit()
    db.refresh(txn)
    return _txn_to_dict(txn)


@router.delete("/transactions/{txn_id}", status_code=204)
def delete_transaction(
    txn_id: int,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    txn = db.query(Transaction).filter(Transaction.id == txn_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(txn)
    db.commit()


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

@router.get("/categories")
def list_categories(
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    cats = db.query(Category).order_by(Category.name).all()
    return [_cat_to_dict(c) for c in cats]


@router.post("/categories", status_code=201)
def create_category(
    body: CategoryCreate,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    existing = db.query(Category).filter(Category.name == body.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="Category already exists")
    cat = Category(name=body.name, monthly_budget=body.monthly_budget)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return _cat_to_dict(cat)


@router.put("/categories/{cat_id}")
def update_category(
    cat_id: int,
    body: CategoryUpdate,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if body.name is not None:
        # Check uniqueness
        dup = db.query(Category).filter(Category.name == body.name, Category.id != cat_id).first()
        if dup:
            raise HTTPException(status_code=409, detail="Category name already taken")
        cat.name = body.name
    if body.monthly_budget is not None:
        cat.monthly_budget = body.monthly_budget
    db.commit()
    db.refresh(cat)
    return _cat_to_dict(cat)


@router.delete("/categories/{cat_id}", status_code=204)
def delete_category(
    cat_id: int,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    cat = db.query(Category).filter(Category.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    db.delete(cat)
    db.commit()


# ---------------------------------------------------------------------------
# Vendor mappings
# ---------------------------------------------------------------------------

@router.get("/vendor-mappings")
def list_vendor_mappings(
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    mappings = db.query(VendorMapping).all()
    return [{"id": m.id, "keyword": m.keyword, "category": m.category} for m in mappings]


@router.post("/vendor-mappings", status_code=201)
def create_vendor_mapping(
    body: VendorMappingCreate,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    mapping = VendorMapping(keyword=body.keyword, category=body.category)
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return {"id": mapping.id, "keyword": mapping.keyword, "category": mapping.category}


@router.delete("/vendor-mappings/{mapping_id}", status_code=204)
def delete_vendor_mapping(
    mapping_id: int,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    mapping = db.query(VendorMapping).filter(VendorMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Vendor mapping not found")
    db.delete(mapping)
    db.commit()


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    today = date.today()
    period_start = _pay_period_start(db)
    month_start = period_start.isoformat()
    month_end = today.isoformat()

    month_txns = (
        db.query(Transaction)
        .filter(Transaction.date >= month_start, Transaction.date <= month_end)
        .all()
    )

    total_in = sum(t.amount for t in month_txns if t.direction == "credit")

    # Use amortised total_out — requires all debits (not just current period)
    all_debits = db.query(Transaction).filter(Transaction.direction == "debit").all()
    total_out, cat_spend_amortised, active_amortised = _amortised_total_out(all_debits, period_start, today)
    net = total_in - total_out

    # Credit card outstanding — SQL aggregates, no full table load
    from sqlalchemy import func, case, or_
    cc_rows = db.query(
        Transaction.direction,
        func.sum(Transaction.amount).label("total"),
    ).filter(
        or_(
            Transaction.payment_method == "credit_card",
            func.lower(Transaction.bank).contains("credit"),
            func.lower(Transaction.bank).contains("amex"),
        )
    ).group_by(Transaction.direction).all()
    cc_map = {r.direction: r.total for r in cc_rows}
    cc_outstanding = max((cc_map.get("debit", 0) or 0) - (cc_map.get("credit", 0) or 0), 0.0)

    net_balance = net - cc_outstanding

    debits = [t for t in month_txns if t.direction == "debit"]

    # Average daily spend — use amortised cat_spend, excluding rent/investments
    EXCLUDE_FROM_DAILY = {"rent", "investment", "investments"}
    daily_spend_base = sum(
        v for k, v in cat_spend_amortised.items()
        if k.lower() not in EXCLUDE_FROM_DAILY
    )
    days_in_period = max((today - period_start).days, 1)
    avg_daily_spend = daily_spend_base / days_in_period

    # Top vendor by transaction count (current period, raw — amortised txns don't distort frequency)
    vendor_count: dict = {}
    for t in debits:
        vendor_count[t.vendor] = vendor_count.get(t.vendor, 0) + 1
    top_vendor = max(vendor_count, key=lambda k: vendor_count[k], default=None)

    # Top category by amortised spend
    cat_spend = cat_spend_amortised
    top_category = max(cat_spend, key=lambda k: cat_spend[k], default=None)

    # Budget status per category
    categories = db.query(Category).all()
    budget_status = []
    for cat in categories:
        if cat.monthly_budget is None:
            continue
        spent = cat_spend.get(cat.name, 0.0)
        pct = (spent / cat.monthly_budget * 100) if cat.monthly_budget else 0.0
        budget_status.append(
            {
                "category": cat.name,
                "spent": round(spent, 2),
                "limit": cat.monthly_budget,
                "percent": round(pct, 1),
                "over_budget": spent > cat.monthly_budget,
            }
        )

    # Recent 10 transactions (all time, newest first)
    recent = (
        db.query(Transaction)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(10)
        .all()
    )
    recent_transactions = [_txn_to_dict(t) for t in recent]

    # Pending split receivables — single bulk fetch for associated transactions
    from models import SplitExpense
    pending_splits = db.query(SplitExpense).filter(SplitExpense.status != "settled").all()
    total_splits_owed = sum(s.amount_owed - s.amount_received for s in pending_splits)
    if pending_splits:
        split_txn_ids = {s.transaction_id for s in pending_splits}
        split_txns = {t.id: t for t in db.query(Transaction).filter(Transaction.id.in_(split_txn_ids)).all()}
    else:
        split_txns = {}
    pending_splits_list = [_split_to_dict(s, split_txns.get(s.transaction_id)) for s in pending_splits]

    return {
        "period": {"start": month_start, "end": month_end},
        "total_in": round(total_in, 2),
        "total_out": round(total_out, 2),
        "net": round(net, 2),
        "cc_outstanding": round(cc_outstanding, 2),
        "net_balance": round(net_balance, 2),
        "pending_splits_receivable": round(total_splits_owed, 2),
        "pending_splits": pending_splits_list,
        "avg_daily_spend": round(avg_daily_spend, 2),
        "active_amortised": active_amortised,
        "top_vendor": top_vendor,
        "top_category": top_category,
        "budget_status": budget_status,
        "recent_transactions": recent_transactions,
        "quick_stats": {
            "top_vendor": top_vendor,
            "top_category": top_category,
            "transaction_count": len(month_txns),
        },
    }


# ---------------------------------------------------------------------------
# Analytics helpers
# ---------------------------------------------------------------------------

def _pay_period_trend(db: Session, txns: list, start_date: str, end_date: str, period: str) -> list:
    """
    Group transactions into pay-period buckets (salary date → next salary date).
    Falls back to calendar-month grouping if no salary data exists.
    For single-period views (week / month) returns [] since a trend needs ≥2 points.
    """
    if period in ("week", "month"):
        # A trend across a single period isn't meaningful
        return []

    # Fetch all salary credit dates (sorted ascending) as period boundaries
    salary_rows = (
        db.query(Transaction.date)
        .filter(
            Transaction.direction == "credit",
            Transaction.category == "Salary",
        )
        .order_by(Transaction.date)
        .all()
    )
    salary_dates = sorted({r.date for r in salary_rows})

    if not salary_dates:
        # Fallback: calendar-month grouping
        monthly: dict = {}
        for t in txns:
            ym = t.date[:7]
            monthly[ym] = monthly.get(ym, 0.0) + t.amount
        return [
            {"month": ym, "amount": round(amt, 2)}
            for ym, amt in sorted(monthly.items())
        ]

    # Include one salary date before start_date so we have an opening boundary
    earlier = (
        db.query(Transaction.date)
        .filter(
            Transaction.direction == "credit",
            Transaction.category == "Salary",
            Transaction.date < start_date,
        )
        .order_by(Transaction.date.desc())
        .first()
    )
    boundaries = []
    if earlier:
        boundaries.append(earlier.date)
    boundaries.extend(d for d in salary_dates if d >= start_date)
    # Sentinel end
    boundaries.append(end_date)

    # Remove duplicate boundaries and sort
    boundaries = sorted(set(boundaries))

    # Build labelled buckets (label = "MMM 'YY" of period start)
    buckets: dict = {}  # label → amount
    bucket_order = []
    for i in range(len(boundaries) - 1):
        label = date.fromisoformat(boundaries[i]).strftime("%b '%y")
        if label not in buckets:
            buckets[label] = 0.0
            bucket_order.append((boundaries[i], label))

    # Assign each transaction to the correct bucket
    for t in txns:
        assigned = None
        for i in range(len(boundaries) - 1):
            if boundaries[i] <= t.date <= boundaries[i + 1]:
                assigned = date.fromisoformat(boundaries[i]).strftime("%b '%y")
                break
        if assigned:
            buckets[assigned] = buckets.get(assigned, 0.0) + t.amount

    return [
        {"month": label, "amount": round(buckets.get(label, 0.0), 2)}
        for _, label in sorted(bucket_order)
    ]


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

@router.get("/analytics")
def analytics(
    period: str = Query("month", description="week|month|3months|12months|custom"),
    start: Optional[str] = Query(None, description="YYYY-MM-DD (required for custom)"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD (required for custom)"),
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    from datetime import timedelta

    today = date.today()

    if period == "week":
        start_date = (today - timedelta(days=7)).isoformat()
        end_date = today.isoformat()
    elif period == "month":
        start_date = _pay_period_start(db).isoformat()
        end_date = today.isoformat()
    elif period == "3months":
        # Go back 3 calendar months
        month = today.month - 3
        year = today.year
        if month <= 0:
            month += 12
            year -= 1
        start_date = today.replace(year=year, month=month, day=1).isoformat()
        end_date = today.isoformat()
    elif period in ("12months", "year"):
        month = today.month
        year = today.year - 1
        start_date = today.replace(year=year, month=month, day=1).isoformat()
        end_date = today.isoformat()
    elif period == "custom":
        if not start or not end:
            raise HTTPException(
                status_code=400, detail="Provide start and end for custom period"
            )
        start_date = start
        end_date = end
    else:
        raise HTTPException(status_code=400, detail="Invalid period")

    txns = (
        db.query(Transaction)
        .filter(
            Transaction.date >= start_date,
            Transaction.date <= end_date,
            Transaction.direction == "debit",
        )
        .all()
    )

    # Category breakdown
    cat_totals: dict = {}
    for t in txns:
        cat_totals[t.category] = cat_totals.get(t.category, 0.0) + t.amount
    total_spend = sum(cat_totals.values())
    category_breakdown = [
        {
            "category": cat,
            "amount": round(amt, 2),
            "percent": round((amt / total_spend * 100) if total_spend else 0.0, 1),
        }
        for cat, amt in sorted(cat_totals.items(), key=lambda x: x[1], reverse=True)
    ]

    # Monthly trend — bucket by pay period (salary date → next salary date)
    # so a pay period starting on the 28th doesn't get split across two calendar months.
    monthly_trend = _pay_period_trend(db, txns, start_date, end_date, period)

    return {
        "period": {"start": start_date, "end": end_date},
        "total_spend": round(total_spend, 2),
        "category_breakdown": category_breakdown,
        "monthly_trend": monthly_trend,
    }


# ---------------------------------------------------------------------------
# Banks
# ---------------------------------------------------------------------------

@router.get("/banks")
def banks_overview(
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Return per-bank-account and per-credit-card summaries with flow charts."""
    from collections import defaultdict

    all_txns = (
        db.query(Transaction)
        .filter(Transaction.bank.isnot(None))
        .order_by(Transaction.date)
        .all()
    )

    if not all_txns:
        return {"banks": [], "credit_cards": [], "cumulative_balance": [], "bank_names": []}

    # --- Classify each transaction as bank_account or credit_card ---
    # Heuristic: explicit payment_method wins; fall back to bank name keywords
    CC_KEYWORDS = {"credit", "amex", "american express", "cc"}

    def _is_cc(t: Transaction) -> bool:
        if t.payment_method == "credit_card":
            return True
        if t.payment_method in ("upi", "debit_card", "net_banking"):
            return False
        # fallback: check bank name
        return any(kw in (t.bank or "").lower() for kw in CC_KEYWORDS)

    # --- Group by (bank_name, kind) so HDFC bank ≠ HDFC credit card ---
    groups: dict = {}   # key: (bank, kind) -> aggregate dict
    for t in all_txns:
        kind = "credit_card" if _is_cc(t) else "bank_account"
        key = (t.bank, kind)
        if key not in groups:
            groups[key] = {
                "bank": t.bank,
                "kind": kind,
                "accounts": set(),
                "total_in": 0.0,
                "total_out": 0.0,
                "transaction_count": 0,
                "last_activity": t.date,
                "txns": [],
            }
        g = groups[key]
        if t.account_last4:
            g["accounts"].add(t.account_last4)
        if t.direction == "credit":
            g["total_in"] += t.amount
        else:
            g["total_out"] += t.amount
        g["transaction_count"] += 1
        if t.date > g["last_activity"]:
            g["last_activity"] = t.date
        g["txns"].append(t)

    # --- Pay-period boundaries for monthly flow ---
    salary_dates = sorted({
        r.date for r in db.query(Transaction.date)
        .filter(Transaction.direction == "credit", Transaction.category == "Salary")
        .all()
    })

    def _monthly_flow(txns):
        if not salary_dates:
            buckets: dict = {}
            for t in sorted(txns, key=lambda x: x.date):
                ym = t.date[:7]
                if ym not in buckets:
                    buckets[ym] = {"month": date.fromisoformat(ym + "-01").strftime("%b '%y"), "in": 0.0, "out": 0.0}
                if t.direction == "credit":
                    buckets[ym]["in"] += t.amount
                else:
                    buckets[ym]["out"] += t.amount
            return [
                {"month": v["month"], "in": round(v["in"], 2), "out": round(v["out"], 2), "net": round(v["in"] - v["out"], 2)}
                for v in sorted(buckets.values(), key=lambda x: x["month"])
            ]

        boundaries = salary_dates + [date.today().isoformat()]
        buckets2: dict = {}
        order = []
        for i in range(len(boundaries) - 1):
            label = date.fromisoformat(boundaries[i]).strftime("%b '%y")
            if label not in buckets2:
                buckets2[label] = {"in": 0.0, "out": 0.0}
                order.append((boundaries[i], label))
        for t in txns:
            for i in range(len(boundaries) - 1):
                if boundaries[i] <= t.date <= boundaries[i + 1]:
                    lbl = date.fromisoformat(boundaries[i]).strftime("%b '%y")
                    if lbl in buckets2:
                        if t.direction == "credit":
                            buckets2[lbl]["in"] += t.amount
                        else:
                            buckets2[lbl]["out"] += t.amount
                    break
        return [
            {"month": lbl, "in": round(buckets2[lbl]["in"], 2), "out": round(buckets2[lbl]["out"], 2),
             "net": round(buckets2[lbl]["in"] - buckets2[lbl]["out"], 2)}
            for _, lbl in sorted(order)
        ]

    # --- Build output lists ---
    accounts_list = []
    cards_list = []

    for (bank, kind), g in sorted(groups.items()):
        entry = {
            "name": bank,
            "display_name": f"{bank} Credit Card" if kind == "credit_card" else bank,
            "kind": kind,
            "accounts": sorted(g["accounts"]),
            "total_in": round(g["total_in"], 2),
            "total_out": round(g["total_out"], 2),
            "net_flow": round(g["total_in"] - g["total_out"], 2),
            "transaction_count": g["transaction_count"],
            "last_activity": g["last_activity"],
            "monthly_flow": _monthly_flow(g["txns"]),
        }
        if kind == "credit_card":
            entry["outstanding"] = round(g["total_out"] - g["total_in"], 2)
            cards_list.append(entry)
        else:
            accounts_list.append(entry)

    # --- Cumulative net-flow (bank accounts only, not CC liabilities) ---
    bank_account_keys = [k for k in groups if k[1] == "bank_account"]
    bank_account_names = [k[0] for k in bank_account_keys]

    running = {b: 0.0 for b in bank_account_names}
    by_date: dict = defaultdict(list)
    for t in all_txns:
        if not _is_cc(t):
            by_date[t.date].append(t)

    cumulative_balance = []
    for d in sorted(by_date.keys()):
        for t in by_date[d]:
            delta = t.amount if t.direction == "credit" else -t.amount
            running[t.bank] = running.get(t.bank, 0.0) + delta
        cumulative_balance.append({
            "date": d,
            **{b: round(running[b], 2) for b in bank_account_names},
        })

    return {
        "banks": accounts_list,
        "credit_cards": cards_list,
        "cumulative_balance": cumulative_balance,
        "bank_names": bank_account_names,
    }


# ---------------------------------------------------------------------------
# Credit Cards
# ---------------------------------------------------------------------------

@router.get("/credit-cards")
def credit_cards_overview(
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Dedicated credit-card view: per-card summary, category breakdown, monthly trend, recent txns."""
    from collections import defaultdict

    CC_KEYWORDS = {"credit", "amex", "american express", "cc"}

    def _is_cc(t: Transaction) -> bool:
        if t.payment_method == "credit_card":
            return True
        if t.payment_method in ("upi", "debit_card", "net_banking"):
            return False
        return any(kw in (t.bank or "").lower() for kw in CC_KEYWORDS)

    all_cc_txns = [
        t for t in db.query(Transaction).filter(Transaction.bank.isnot(None)).order_by(Transaction.date).all()
        if _is_cc(t)
    ]

    if not all_cc_txns:
        return {"cards": []}

    # Pay-period boundaries
    salary_dates = sorted({
        r.date for r in db.query(Transaction.date)
        .filter(Transaction.direction == "credit", Transaction.category == "Salary")
        .all()
    })

    def _monthly_spend(txns):
        """Charges (debits) bucketed by pay period."""
        debits = [t for t in txns if t.direction == "debit"]
        if not salary_dates:
            buckets: dict = {}
            for t in sorted(debits, key=lambda x: x.date):
                ym = t.date[:7]
                if ym not in buckets:
                    buckets[ym] = {"month": date.fromisoformat(ym + "-01").strftime("%b '%y"), "spend": 0.0}
                buckets[ym]["spend"] += t.amount
            return [{"month": v["month"], "spend": round(v["spend"], 2)} for v in sorted(buckets.values(), key=lambda x: x["month"])]

        boundaries = salary_dates + [date.today().isoformat()]
        buckets2: dict = {}
        order = []
        for i in range(len(boundaries) - 1):
            lbl = date.fromisoformat(boundaries[i]).strftime("%b '%y")
            if lbl not in buckets2:
                buckets2[lbl] = 0.0
                order.append((boundaries[i], lbl))
        for t in debits:
            for i in range(len(boundaries) - 1):
                if boundaries[i] <= t.date <= boundaries[i + 1]:
                    lbl = date.fromisoformat(boundaries[i]).strftime("%b '%y")
                    if lbl in buckets2:
                        buckets2[lbl] += t.amount
                    break
        return [{"month": lbl, "spend": round(buckets2[lbl], 2)} for _, lbl in sorted(order)]

    # Group by bank (each bank's CC is one card)
    groups: dict = defaultdict(lambda: {
        "accounts": set(), "total_charges": 0.0, "total_payments": 0.0,
        "transaction_count": 0, "last_activity": "", "txns": []
    })
    for t in all_cc_txns:
        g = groups[t.bank]
        if t.account_last4:
            g["accounts"].add(t.account_last4)
        if t.direction == "debit":
            g["total_charges"] += t.amount
        else:
            g["total_payments"] += t.amount
        g["transaction_count"] += 1
        if not g["last_activity"] or t.date > g["last_activity"]:
            g["last_activity"] = t.date
        g["txns"].append(t)

    cards = []
    for bank, g in sorted(groups.items()):
        debits = [t for t in g["txns"] if t.direction == "debit"]

        # Category breakdown (charges only)
        cat_totals: dict = defaultdict(float)
        for t in debits:
            cat_totals[t.category or "Miscellaneous"] += t.amount
        total_charges = g["total_charges"]
        category_breakdown = sorted(
            [{"category": c, "amount": round(a, 2), "percent": round(a / total_charges * 100, 1) if total_charges else 0}
             for c, a in cat_totals.items()],
            key=lambda x: x["amount"], reverse=True
        )

        # Recent 8 transactions (newest first)
        recent = sorted(g["txns"], key=lambda x: (x.date, x.id), reverse=True)[:8]
        recent_txns = [
            {"id": t.id, "date": t.date, "vendor": t.vendor, "amount": t.amount,
             "direction": t.direction, "category": t.category}
            for t in recent
        ]

        # Current pay-period spend
        period_start = _pay_period_start(db).isoformat()
        period_spend = sum(t.amount for t in debits if t.date >= period_start)

        cards.append({
            "name": bank,
            "display_name": f"{bank} Credit Card",
            "accounts": sorted(g["accounts"]),
            "total_charges": round(total_charges, 2),
            "total_payments": round(g["total_payments"], 2),
            "outstanding": round(total_charges - g["total_payments"], 2),
            "transaction_count": g["transaction_count"],
            "last_activity": g["last_activity"],
            "period_spend": round(period_spend, 2),
            "monthly_spend": _monthly_spend(g["txns"]),
            "category_breakdown": category_breakdown,
            "recent_transactions": recent_txns,
        })

    return {"cards": cards}


# ---------------------------------------------------------------------------
# Split Expenses
# ---------------------------------------------------------------------------

class SplitCreate(BaseModel):
    transaction_id: int
    total_people: int
    notes: Optional[str] = None


class SplitSettle(BaseModel):
    amount_received: float


@router.post("/splits", status_code=201)
def create_split(
    body: SplitCreate,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    from models import SplitExpense
    txn = db.query(Transaction).filter(Transaction.id == body.transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if body.total_people < 2:
        raise HTTPException(status_code=400, detail="total_people must be at least 2")

    amount_owed = round(txn.amount * (body.total_people - 1) / body.total_people, 2)
    split = SplitExpense(
        transaction_id=body.transaction_id,
        total_people=body.total_people,
        amount_owed=amount_owed,
        amount_received=0.0,
        notes=body.notes,
        status="pending",
    )
    db.add(split)
    db.commit()
    db.refresh(split)
    return _split_to_dict(split, txn)


@router.get("/splits")
def list_splits(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    from models import SplitExpense
    q = db.query(SplitExpense)
    if status:
        q = q.filter(SplitExpense.status == status)
    splits = q.order_by(SplitExpense.created_at.desc()).all()
    if splits:
        txn_ids = {s.transaction_id for s in splits}
        txns = {t.id: t for t in db.query(Transaction).filter(Transaction.id.in_(txn_ids)).all()}
    else:
        txns = {}
    return [_split_to_dict(s, txns.get(s.transaction_id)) for s in splits]


@router.patch("/splits/{split_id}/settle")
def settle_split(
    split_id: int,
    body: SplitSettle,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    from models import SplitExpense
    split = db.query(SplitExpense).filter(SplitExpense.id == split_id).first()
    if not split:
        raise HTTPException(status_code=404, detail="Split not found")

    split.amount_received = round(split.amount_received + body.amount_received, 2)
    if split.amount_received >= split.amount_owed:
        split.status = "settled"
        split.settled_at = datetime.utcnow()
    else:
        split.status = "partial"
    db.commit()
    db.refresh(split)
    txn = db.query(Transaction).filter(Transaction.id == split.transaction_id).first()
    return _split_to_dict(split, txn)


@router.delete("/splits/{split_id}", status_code=204)
def delete_split(
    split_id: int,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    from models import SplitExpense
    split = db.query(SplitExpense).filter(SplitExpense.id == split_id).first()
    if not split:
        raise HTTPException(status_code=404, detail="Split not found")
    db.delete(split)
    db.commit()


def _split_to_dict(split, txn) -> dict:
    return {
        "id": split.id,
        "transaction_id": split.transaction_id,
        "total_people": split.total_people,
        "amount_owed": split.amount_owed,
        "amount_received": round(split.amount_received, 2),
        "amount_outstanding": round(split.amount_owed - split.amount_received, 2),
        "notes": split.notes,
        "status": split.status,
        "created_at": split.created_at.isoformat() if split.created_at else None,
        "settled_at": split.settled_at.isoformat() if split.settled_at else None,
        "transaction": {
            "id": txn.id, "date": txn.date, "vendor": txn.vendor,
            "amount": txn.amount, "category": txn.category,
        } if txn else None,
    }


# ---------------------------------------------------------------------------
# Vendors
# ---------------------------------------------------------------------------

@router.get("/vendors")
def top_vendors(
    limit: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    results = (
        db.query(
            Transaction.vendor,
            func.sum(Transaction.amount).label("total_spend"),
            func.count(Transaction.id).label("transaction_count"),
            func.avg(Transaction.amount).label("avg_amount"),
        )
        .filter(Transaction.direction == "debit")
        .group_by(Transaction.vendor)
        .order_by(func.sum(Transaction.amount).desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "vendor": row.vendor,
            "total_spend": round(row.total_spend, 2),
            "transaction_count": row.transaction_count,
            "avg_amount": round(row.avg_amount, 2),
        }
        for row in results
    ]


# ---------------------------------------------------------------------------
# Authenticated upload (used by the mobile web UI)
# ---------------------------------------------------------------------------

@router.post("/upload")
async def authenticated_upload(
    file: Optional[UploadFile] = File(None),
    text: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Same logic as /webhook/upload but secured by JWT instead of webhook secret."""
    from routers.webhook import _transaction_dict
    from services.ai_extraction import extract_from_image, extract_from_text
    from services.compression import compress_image, compress_pdf

    if not file and not text:
        raise HTTPException(status_code=400, detail="Provide file or text")

    if file:
        file_bytes = await file.read()
        sha256 = hashlib.sha256(file_bytes).hexdigest()
    else:
        sha256 = hashlib.sha256(text.encode()).hexdigest()

    existing = db.query(Transaction).filter(Transaction.sha256_hash == sha256).first()
    if existing:
        return {"duplicate": True, "transaction": _transaction_dict(existing), "budget_warning": False, "budget_details": []}

    categories = [c.name for c in db.query(Category).all()]
    vendor_mappings = [{"keyword": vm.keyword, "category": vm.category} for vm in db.query(VendorMapping).all()]

    extracted = None
    file_path = None

    if text:
        extracted = await extract_from_text(text, vendor_mappings, categories)
    elif file:
        content_type = file.content_type or ""
        filename = file.filename or "upload"
        if content_type == "application/pdf":
            file_path, img_bytes = compress_pdf(file_bytes, filename, sha256)
            if img_bytes:
                extracted = await extract_from_image(img_bytes, "image/jpeg", vendor_mappings, categories, "invoice_pdf")
        elif content_type.startswith("image/"):
            extracted = await extract_from_image(file_bytes, content_type, vendor_mappings, categories)
            if extracted and extracted.get("source_type") != "upi_sms":
                file_path = compress_image(file_bytes, filename, sha256)
        else:
            raise HTTPException(status_code=415, detail=f"Unsupported file type: {content_type}")

    if not extracted:
        raise HTTPException(status_code=422, detail="Could not extract transaction data")

    txn = Transaction(
        sha256_hash=sha256,
        amount=extracted.get("amount", 0),
        currency=extracted.get("currency", "INR"),
        direction=extracted.get("direction", "debit"),
        vendor=extracted.get("vendor", ""),
        bank=extracted.get("bank"),
        account_last4=extracted.get("account_last4"),
        date=extracted.get("date", datetime.utcnow().strftime("%Y-%m-%d")),
        upi_ref=extracted.get("upi_ref"),
        category=extracted.get("category", "Miscellaneous"),
        raw_text=extracted.get("raw_text", ""),
        source_type=extracted.get("source_type", "manual"),
        file_path=file_path,
        payment_method=extracted.get("payment_method"),
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)

    budget_warning = False
    budget_details = []
    category_obj = db.query(Category).filter(Category.name == txn.category).first()
    if category_obj and category_obj.monthly_budget:
        now = datetime.utcnow()
        month_start = f"{now.year}-{now.month:02d}-01"
        month_end = f"{now.year}-{now.month:02d}-31"
        spent = sum(t.amount for t in db.query(Transaction).filter(
            Transaction.category == txn.category,
            Transaction.direction == "debit",
            Transaction.date >= month_start,
            Transaction.date <= month_end,
        ).all())
        limit = category_obj.monthly_budget
        pct = (spent / limit * 100) if limit else 0.0
        if pct >= 90:
            budget_warning = True
        budget_details.append({"category": txn.category, "spent": round(spent, 2), "limit": limit, "percent": round(pct, 1)})

    return {"transaction": _transaction_dict(txn), "budget_warning": budget_warning, "budget_details": budget_details}


@router.post("/upload/bulk")
async def bulk_upload(
    files: Optional[List[UploadFile]] = File(None),
    texts: Optional[str] = Form(None),  # newline-separated SMS messages
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Process multiple files and/or multiple SMS texts in one request."""
    results = []

    async def _process_single(file=None, text=None):
        try:
            res = await authenticated_upload(
                file=file, text=text, db=db, _user=_user
            )
            return {"status": "ok", "name": file.filename if file else text[:40] + "…" if text and len(text) > 40 else text, **res}
        except HTTPException as e:
            return {"status": "error", "name": file.filename if file else (text or "")[:40], "error": e.detail}
        except Exception as e:
            return {"status": "error", "name": file.filename if file else (text or "")[:40], "error": str(e)}

    if files:
        for f in files:
            results.append(await _process_single(file=f))

    if texts:
        for line in texts.splitlines():
            line = line.strip()
            if line:
                results.append(await _process_single(text=line))

    return {"results": results, "total": len(results), "succeeded": sum(1 for r in results if r["status"] == "ok")}


# ---------------------------------------------------------------------------
# Bank statement upload
# ---------------------------------------------------------------------------

class StatementTransaction(BaseModel):
    amount: float
    currency: str = "INR"
    direction: str
    vendor: str
    bank: Optional[str] = None
    account_last4: Optional[str] = None
    date: str
    upi_ref: Optional[str] = None
    category: str = "Miscellaneous"
    raw_text: Optional[str] = ""
    source_type: str = "bank_statement"
    notes: Optional[str] = None
    payment_method: Optional[str] = None


class StatementConfirm(BaseModel):
    transactions: List[StatementTransaction]


@router.post("/upload/statement/parse")
async def parse_statement(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """
    Upload a bank statement PDF. Returns extracted transactions for review.
    Does NOT save to DB yet — call /upload/statement/confirm to commit.
    """
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Only PDF bank statements are supported")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 20MB)")

    from services.ai_extraction import extract_bank_statement

    categories = [c.name for c in db.query(Category).all()]
    vendor_mappings = [
        {"keyword": vm.keyword, "category": vm.category}
        for vm in db.query(VendorMapping).all()
    ]

    try:
        transactions = await extract_bank_statement(pdf_bytes, vendor_mappings, categories)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse statement: {e}")

    if not transactions:
        raise HTTPException(status_code=422, detail="No transactions found in this PDF")

    # Flag duplicates (already in DB) so frontend can show them
    enriched = []
    for txn in transactions:
        sha = hashlib.sha256(
            f"{txn.get('amount')}{txn.get('vendor')}{txn.get('date')}{txn.get('direction')}".encode()
        ).hexdigest()
        existing = db.query(Transaction).filter(Transaction.sha256_hash == sha).first()
        enriched.append({**txn, "_duplicate": existing is not None, "_sha256": sha})

    return {"transactions": enriched, "total": len(enriched)}


@router.post("/upload/statement/confirm")
async def confirm_statement(
    body: StatementConfirm,
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Save the user-reviewed transactions from a bank statement."""
    saved = 0
    skipped = 0
    errors = []

    for t in body.transactions:
        sha = hashlib.sha256(
            f"{t.amount}{t.vendor}{t.date}{t.direction}".encode()
        ).hexdigest()
        if db.query(Transaction).filter(Transaction.sha256_hash == sha).first():
            skipped += 1
            continue
        try:
            txn = Transaction(
                sha256_hash=sha,
                amount=t.amount,
                currency=t.currency,
                direction=t.direction,
                vendor=t.vendor,
                bank=t.bank,
                account_last4=t.account_last4,
                date=t.date,
                upi_ref=t.upi_ref,
                category=t.category,
                raw_text=t.raw_text or "",
                source_type=t.source_type,
                notes=t.notes,
                payment_method=t.payment_method,
            )
            db.add(txn)
            db.commit()
            saved += 1
        except Exception as e:
            db.rollback()
            errors.append(f"{t.vendor} {t.date}: {e}")

    return {"saved": saved, "skipped_duplicates": skipped, "errors": errors}
