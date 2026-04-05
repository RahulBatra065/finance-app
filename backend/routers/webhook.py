import hashlib
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from models import Category, Transaction, VendorMapping
from services.ai_extraction import extract_from_image, extract_from_text
from services.compression import compress_image, compress_pdf

router = APIRouter()


@router.get("/ping")
async def ping():
    return {"ok": True}


@router.post("/debug")
async def debug(request: Request):
    """Unauthenticated debug endpoint — logs everything to stdout."""
    import sys
    body = await request.body()
    try:
        body_str = body.decode("utf-8", errors="replace")
    except Exception:
        body_str = repr(body)

    print("\n" + "="*60, flush=True)
    print("DEBUG WEBHOOK REQUEST", flush=True)
    print("="*60, flush=True)
    print(f"Content-Type : {request.headers.get('content-type')}", flush=True)
    print(f"Body length  : {len(body)} bytes", flush=True)
    print(f"Body preview : {body_str[:1000]}", flush=True)
    print("All headers  :", flush=True)
    for k, v in request.headers.items():
        print(f"  {k}: {v}", flush=True)
    print("="*60 + "\n", flush=True)
    sys.stdout.flush()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

def verify_webhook_secret(x_webhook_secret: str = Header(...)):
    expected = os.getenv("WEBHOOK_SECRET", "")
    if x_webhook_secret != expected:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _transaction_dict(txn: Transaction) -> dict:
    return {
        "id": txn.id,
        "amount": txn.amount,
        "currency": txn.currency,
        "direction": txn.direction,
        "vendor": txn.vendor,
        "bank": txn.bank,
        "account_last4": txn.account_last4,
        "date": txn.date,
        "upi_ref": txn.upi_ref,
        "category": txn.category,
        "raw_text": txn.raw_text,
        "source_type": txn.source_type,
        "file_path": txn.file_path,
        "notes": txn.notes,
        "created_at": txn.created_at.isoformat() if txn.created_at else None,
    }


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload(
    request: Request,
    file: Optional[UploadFile] = File(None),
    text: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    _: None = Depends(verify_webhook_secret),
):
    # Also accept raw text/plain body or JSON {"text": "..."} so automations
    # (iOS Shortcuts, HDFC SMS triggers, etc.) can POST without form encoding.
    if not file and not text:
        content_type = request.headers.get("content-type", "")
        raw = await request.body()
        if raw:
            if "application/json" in content_type:
                import json as _json
                try:
                    payload = _json.loads(raw)
                    text = payload.get("text") or payload.get("message") or payload.get("body")
                except Exception:
                    pass
            else:
                # Treat anything else (text/plain, no content-type) as raw SMS text
                text = raw.decode("utf-8", errors="replace").strip()

    if not file and not text:
        raise HTTPException(status_code=400, detail="Provide file or text")

    # ------------------------------------------------------------------
    # Compute SHA-256 hash
    # ------------------------------------------------------------------
    if file:
        file_bytes = await file.read()
        sha256 = hashlib.sha256(file_bytes).hexdigest()
    else:
        sha256 = hashlib.sha256(text.encode()).hexdigest()

    # ------------------------------------------------------------------
    # Duplicate check
    # ------------------------------------------------------------------
    existing = db.query(Transaction).filter(Transaction.sha256_hash == sha256).first()
    if existing:
        return {"duplicate": True, "transaction": _transaction_dict(existing)}

    # ------------------------------------------------------------------
    # Build AI context
    # ------------------------------------------------------------------
    categories = [c.name for c in db.query(Category).all()]
    vendor_mappings = [
        {"keyword": vm.keyword, "category": vm.category}
        for vm in db.query(VendorMapping).all()
    ]

    # ------------------------------------------------------------------
    # AI extraction
    # ------------------------------------------------------------------
    extracted: Optional[dict] = None
    file_path: Optional[str] = None

    if text:
        extracted = await extract_from_text(text, vendor_mappings, categories)

    elif file:
        content_type = file.content_type or ""
        filename = file.filename or "upload"

        if content_type == "application/pdf":
            file_path, img_bytes = compress_pdf(file_bytes, filename, sha256)
            if img_bytes:
                extracted = await extract_from_image(
                    img_bytes, "image/jpeg", vendor_mappings, categories, "invoice_pdf"
                )
            else:
                extracted = {
                    "amount": 0,
                    "currency": "INR",
                    "direction": "debit",
                    "vendor": "Unknown",
                    "bank": None,
                    "account_last4": None,
                    "date": datetime.utcnow().strftime("%Y-%m-%d"),
                    "upi_ref": None,
                    "category": "Miscellaneous",
                    "raw_text": "",
                    "source_type": "invoice_pdf",
                }

        elif content_type.startswith("image/"):
            extracted = await extract_from_image(
                file_bytes, content_type, vendor_mappings, categories
            )
            # UPI screenshots don't need to be stored as files
            if extracted.get("source_type") == "upi_sms":
                file_path = None
            else:
                file_path = compress_image(file_bytes, filename, sha256)

        else:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported content type: {content_type}",
            )

    if not extracted:
        raise HTTPException(status_code=422, detail="Could not extract transaction data")

    # ------------------------------------------------------------------
    # Persist transaction
    # ------------------------------------------------------------------
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
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)

    # ------------------------------------------------------------------
    # Budget warning
    # ------------------------------------------------------------------
    budget_warning = False
    budget_details = []

    category_obj = (
        db.query(Category).filter(Category.name == txn.category).first()
    )
    if category_obj and category_obj.monthly_budget:
        now = datetime.utcnow()
        month_start = f"{now.year}-{now.month:02d}-01"
        month_end = f"{now.year}-{now.month:02d}-31"

        month_txns = (
            db.query(Transaction)
            .filter(
                Transaction.category == txn.category,
                Transaction.direction == "debit",
                Transaction.date >= month_start,
                Transaction.date <= month_end,
            )
            .all()
        )
        spent = sum(t.amount for t in month_txns)
        limit = category_obj.monthly_budget
        pct = (spent / limit) * 100 if limit else 0.0

        if pct >= 90:
            budget_warning = True

        budget_details.append(
            {
                "category": txn.category,
                "spent": round(spent, 2),
                "limit": limit,
                "percent": round(pct, 1),
            }
        )

    return {
        "transaction": _transaction_dict(txn),
        "budget_warning": budget_warning,
        "budget_details": budget_details,
    }
