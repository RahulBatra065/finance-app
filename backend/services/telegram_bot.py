"""
Telegram bot for logging expenses and answering finance questions.

- Send a UPI SMS / photo / PDF  ->  extract, confirm, save
- Correct anything in plain English before saving
- Ask any question about your finances  ->  Claude answers with live DB data
"""

import asyncio
import hashlib
import io
import json
import logging
import os
import re
from datetime import datetime

import anthropic

logger = logging.getLogger(__name__)

_pending: dict[int, dict] = {}        # single-transaction pending confirmation
_pdf_pending: dict[int, bytes] = {}   # PDF bytes waiting for type decision (statement vs invoice)
_statement_pending: dict[int, list] = {}  # extracted statement transactions awaiting bulk confirm
_claude = None


def _get_claude():
    global _claude
    if _claude is None:
        _claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    return _claude


def _safe_amount(val):
    """Return float amount, defaulting to 0 if None/invalid."""
    try:
        return float(val) if val is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _fmt(e: dict) -> str:
    amount = _safe_amount(e.get("amount"))
    sign = "+" if e.get("direction") == "credit" else "-"
    icon = "💰" if e.get("direction") == "credit" else "💸"
    lines = [
        f"{icon} {sign}Rs.{amount:.2f}  |  {e.get('vendor') or '?'}",
        f"Category : {e.get('category') or '?'}",
        f"Date     : {e.get('date') or '?'}",
        f"Type     : {(e.get('source_type') or 'manual').replace('_', ' ')}",
    ]
    if e.get("bank"):
        acct = f" *{e['account_last4']}" if e.get("account_last4") else ""
        lines.append(f"Bank     : {e['bank']}{acct}")
    if e.get("upi_ref"):
        lines.append(f"Ref      : {e['upi_ref']}")
    if e.get("notes"):
        lines.append(f"Notes    : {e['notes']}")
    return "\n".join(lines)


async def _apply_correction(extracted: dict, user_message: str, categories: list) -> tuple[dict, str]:
    """
    Ask Claude to apply the user's free-form correction to the extracted transaction.
    Returns (updated_dict, explanation).
    """
    prompt = f"""The user has a pending transaction and wants to correct it.

Current transaction data:
{json.dumps(extracted, indent=2)}

Available categories: {', '.join(categories)}

User's correction message: "{user_message}"

Apply the correction(s) the user requested and return the updated transaction as valid JSON only.
Fix typos, understand natural language like "make it food", "wrong vendor it's swiggy", "this is income", "add note reimbursed", etc.
Return ONLY the updated JSON object with the same fields. No explanation, no markdown."""

    response = _get_claude().messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = response.content[0].text.strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)
    updated = json.loads(raw)
    # Preserve any fields Claude accidentally dropped
    for k, v in extracted.items():
        if k not in updated:
            updated[k] = v
    return updated, ""


async def _get_ai_context():
    from database import SessionLocal
    from models import Category, VendorMapping
    db = SessionLocal()
    try:
        categories = [c.name for c in db.query(Category).all()]
        mappings = [{"keyword": vm.keyword, "category": vm.category}
                    for vm in db.query(VendorMapping).all()]
        return categories, mappings
    finally:
        db.close()


def _build_finance_snapshot() -> dict:
    """Pull a concise snapshot of the user's finances from the DB for Claude context."""
    from database import SessionLocal
    from models import Transaction, Category, Holding
    from datetime import date, timedelta

    db = SessionLocal()
    try:
        today = date.today()

        # Use salary-based pay period start (mirrors the dashboard logic)
        salary_txn = (
            db.query(Transaction)
            .filter(Transaction.direction == "credit", Transaction.category == "Salary")
            .order_by(Transaction.date.desc())
            .first()
        )
        if salary_txn:
            pay_start = date.fromisoformat(salary_txn.date)
            if pay_start > today:
                pay_start = today.replace(day=1)
        else:
            pay_start = today.replace(day=1)
        month_start = pay_start.isoformat()

        three_months_ago = (today.replace(day=1).replace(
            month=today.month - 3 if today.month > 3 else today.month + 9,
            year=today.year if today.month > 3 else today.year - 1
        )).isoformat()

        # Current month transactions
        month_txns = db.query(Transaction).filter(
            Transaction.date >= month_start
        ).all()

        total_in  = sum(t.amount for t in month_txns if t.direction == "credit")
        total_out = sum(t.amount for t in month_txns if t.direction == "debit")

        # Category breakdown this month
        cat_spend: dict = {}
        for t in month_txns:
            if t.direction == "debit":
                cat_spend[t.category] = cat_spend.get(t.category, 0.0) + t.amount

        # Budget status
        categories = db.query(Category).all()
        budget_status = []
        for cat in categories:
            if cat.monthly_budget:
                spent = cat_spend.get(cat.name, 0.0)
                pct   = (spent / cat.monthly_budget) * 100
                budget_status.append({
                    "category": cat.name,
                    "spent": round(spent, 2),
                    "limit": cat.monthly_budget,
                    "remaining": round(max(cat.monthly_budget - spent, 0), 2),
                    "percent_used": round(pct, 1),
                    "over_budget": spent > cat.monthly_budget,
                })

        # Top 5 vendors this month
        vendor_spend: dict = {}
        for t in month_txns:
            if t.direction == "debit":
                vendor_spend[t.vendor] = vendor_spend.get(t.vendor, 0.0) + t.amount
        top_vendors = sorted(vendor_spend.items(), key=lambda x: x[1], reverse=True)[:5]

        # Last 3 months monthly totals
        past_txns = db.query(Transaction).filter(
            Transaction.date >= three_months_ago,
            Transaction.direction == "debit"
        ).all()
        monthly: dict = {}
        for t in past_txns:
            ym = t.date[:7]
            monthly[ym] = monthly.get(ym, 0.0) + t.amount
        monthly_trend = [{"month": k, "spent": round(v, 2)} for k, v in sorted(monthly.items())]

        # Recent 10 transactions
        recent = db.query(Transaction).order_by(Transaction.created_at.desc()).limit(10).all()
        recent_list = [
            {"date": t.date, "vendor": t.vendor, "amount": t.amount,
             "direction": t.direction, "category": t.category}
            for t in recent
        ]

        # Investments
        holdings = db.query(Holding).all()
        investment_summary = None
        if holdings:
            total_invested = sum(h.units_or_shares * h.average_buy_price for h in holdings)
            total_current  = sum(
                h.units_or_shares * (h.current_price or h.average_buy_price) for h in holdings
            )
            investment_summary = {
                "total_invested": round(total_invested, 2),
                "total_current":  round(total_current, 2),
                "overall_pnl":    round(total_current - total_invested, 2),
                "holdings": [
                    {
                        "name": h.name, "type": h.type,
                        "current_price": h.current_price,
                        "invested": round(h.units_or_shares * h.average_buy_price, 2),
                        "current_value": round(h.units_or_shares * (h.current_price or h.average_buy_price), 2),
                    }
                    for h in holdings
                ]
            }

        return {
            "as_of": today.isoformat(),
            "current_month": {
                "period": f"{month_start} to {today.isoformat()}",
                "total_in":  round(total_in, 2),
                "total_out": round(total_out, 2),
                "net":       round(total_in - total_out, 2),
                "by_category": [{"category": k, "spent": round(v, 2)}
                                 for k, v in sorted(cat_spend.items(), key=lambda x: x[1], reverse=True)],
            },
            "budget_status": budget_status,
            "top_vendors_this_month": [{"vendor": v, "spent": round(s, 2)} for v, s in top_vendors],
            "monthly_trend_last_3": monthly_trend,
            "recent_transactions": recent_list,
            "investments": investment_summary,
        }
    finally:
        db.close()


async def _answer_question(question: str) -> str:
    """Ask Claude a finance question backed by live DB data."""
    snapshot = _build_finance_snapshot()

    prompt = f"""You are a personal finance assistant. Answer the user's question using the data below.
Be concise, friendly, and use Rs. for currency. Use bullet points for lists.
If the answer isn't in the data, say so honestly.

Finance data:
{json.dumps(snapshot, indent=2)}

User's question: {question}"""

    response = _get_claude().messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}]
    )
    return response.content[0].text.strip()


async def _extract_and_reply(update, context, text=None, image_bytes=None, mime_type=None, filename="upload"):
    from services.ai_extraction import extract_from_text, extract_from_image
    from services.compression import compress_image, compress_pdf
    from database import SessionLocal
    from models import Transaction

    user_id = update.effective_user.id
    thinking = await update.message.reply_text("Analysing... give me a sec.")

    try:
        categories, mappings = await _get_ai_context()
        file_path = None
        sha256 = None

        if text:
            sha256 = hashlib.sha256(text.encode()).hexdigest()
            extracted = await extract_from_text(text, mappings, categories)

        elif image_bytes:
            sha256 = hashlib.sha256(image_bytes).hexdigest()
            if mime_type == "application/pdf":
                file_path, img_bytes = compress_pdf(image_bytes, filename, sha256)
                if not img_bytes:
                    await thinking.delete()
                    await update.message.reply_text(
                        "Couldn't read that PDF. Try sending the first page as a photo instead."
                    )
                    return
                extracted = await extract_from_image(
                    img_bytes, "image/jpeg", mappings, categories, "invoice_pdf"
                )
            else:
                extracted = await extract_from_image(
                    image_bytes, mime_type or "image/jpeg", mappings, categories
                )
                if extracted.get("source_type") != "upi_sms":
                    file_path = compress_image(image_bytes, filename, sha256)
        else:
            await thinking.delete()
            await update.message.reply_text(
                "Send me a UPI SMS text, a photo of a receipt, or a PDF."
            )
            return

        # Duplicate check
        db = SessionLocal()
        try:
            existing = db.query(Transaction).filter(
                Transaction.sha256_hash == sha256
            ).first()
            if existing:
                await thinking.delete()
                icon = "💰" if existing.direction == "credit" else "💸"
                sign = "+" if existing.direction == "credit" else "-"
                await update.message.reply_text(
                    f"I've already logged this one!\n\n"
                    f"{icon} {sign}Rs.{existing.amount:.2f}  |  {existing.vendor}\n"
                    f"Category: {existing.category}  |  {existing.date}"
                )
                return
        finally:
            db.close()

        _pending[user_id] = {
            "extracted": extracted,
            "file_path": file_path,
            "sha256": sha256,
        }

        await thinking.delete()
        await update.message.reply_text(
            f"Got it! Here's what I extracted:\n\n"
            f"{_fmt(extracted)}\n\n"
            f"Reply ok to save, or tell me anything to fix — "
            f"e.g. \"make it food\", \"wrong amount it's 450\", \"this is income\", \"add note: reimbursed\""
        )

    except Exception as e:
        logger.exception("Extraction failed")
        try:
            await thinking.delete()
        except Exception:
            pass
        await update.message.reply_text(f"Something went wrong during extraction: {e}")


async def _save_pending(user_id: int, update) -> bool:
    state = _pending.get(user_id)
    if not state:
        await update.message.reply_text(
            "Nothing pending. Send me a transaction first."
        )
        return False

    extracted = state["extracted"]
    from database import SessionLocal
    from models import Transaction, Category

    db = SessionLocal()
    try:
        txn = Transaction(
            sha256_hash=state["sha256"],
            amount=_safe_amount(extracted.get("amount")),
            currency=extracted.get("currency", "INR"),
            direction=extracted.get("direction") or "debit",
            vendor=extracted.get("vendor") or "",
            bank=extracted.get("bank"),
            account_last4=extracted.get("account_last4"),
            date=extracted.get("date") or datetime.utcnow().strftime("%Y-%m-%d"),
            upi_ref=extracted.get("upi_ref"),
            category=extracted.get("category") or "Miscellaneous",
            raw_text=extracted.get("raw_text") or "",
            source_type=extracted.get("source_type") or "manual",
            file_path=state.get("file_path"),
            notes=extracted.get("notes"),
            payment_method=extracted.get("payment_method"),
        )
        db.add(txn)
        db.commit()

        # Budget check
        budget_msg = ""
        cat_obj = db.query(Category).filter(
            Category.name == txn.category
        ).first()
        if cat_obj and cat_obj.monthly_budget:
            now = datetime.utcnow()
            month_start = f"{now.year}-{now.month:02d}-01"
            month_end = f"{now.year}-{now.month:02d}-31"
            spent = sum(
                t.amount for t in db.query(Transaction).filter(
                    Transaction.category == txn.category,
                    Transaction.direction == "debit",
                    Transaction.date >= month_start,
                    Transaction.date <= month_end,
                ).all()
            )
            pct = (spent / cat_obj.monthly_budget) * 100
            if pct >= 90:
                budget_msg = (
                    f"\n\nBudget alert! {txn.category}: {pct:.0f}% used "
                    f"(Rs.{spent:.0f} of Rs.{cat_obj.monthly_budget:.0f})"
                )

        del _pending[user_id]
        icon = "💰" if txn.direction == "credit" else "💸"
        sign = "+" if txn.direction == "credit" else "-"
        await update.message.reply_text(
            f"Saved! {icon} {sign}Rs.{txn.amount:.2f} | {txn.vendor} | {txn.category}{budget_msg}"
        )
        return True

    except Exception as e:
        logger.exception("Save failed")
        await update.message.reply_text(f"Couldn't save: {e}")
        return False
    finally:
        db.close()


async def _process_bank_statement(update, context, pdf_bytes: bytes):
    """Extract all transactions from a bank statement PDF and store in _statement_pending."""
    from services.ai_extraction import extract_bank_statement

    uid = update.effective_user.id
    thinking = await update.message.reply_text("Reading bank statement... this may take a moment.")

    try:
        categories, mappings = await _get_ai_context()
        transactions = await extract_bank_statement(pdf_bytes, mappings, categories)

        if not transactions:
            await thinking.delete()
            await update.message.reply_text(
                "Couldn't find any transactions in that PDF.\n"
                "Make sure it's a digital (not scanned) bank statement, or try a clearer scan."
            )
            return

        _statement_pending[uid] = transactions

        # Build a concise summary
        debits  = [t for t in transactions if t.get("direction") == "debit"]
        credits = [t for t in transactions if t.get("direction") == "credit"]
        total_out = sum(_safe_amount(t.get("amount")) for t in debits)
        total_in  = sum(_safe_amount(t.get("amount")) for t in credits)

        # Show up to 10 lines as a preview
        preview_lines = []
        for t in transactions[:10]:
            sign = "+" if t.get("direction") == "credit" else "-"
            amt  = _safe_amount(t.get("amount"))
            vendor = (t.get("vendor") or "?")[:25]
            date   = t.get("date") or "?"
            preview_lines.append(f"  {sign}Rs.{amt:.0f}  {vendor}  ({date})")

        more = f"\n  ... and {len(transactions) - 10} more" if len(transactions) > 10 else ""

        await thinking.delete()
        await update.message.reply_text(
            f"Found {len(transactions)} transactions:\n"
            f"  Debits : Rs.{total_out:.2f} ({len(debits)} txns)\n"
            f"  Credits: Rs.{total_in:.2f} ({len(credits)} txns)\n\n"
            f"Preview:\n" + "\n".join(preview_lines) + more + "\n\n"
            f"Reply ok to save all, or cancel to discard."
        )

    except Exception as e:
        logger.exception("Bank statement extraction failed")
        try:
            await thinking.delete()
        except Exception:
            pass
        await update.message.reply_text(f"Something went wrong reading the statement: {e}")


async def _save_statement(uid: int, update) -> None:
    """Bulk-save all transactions from _statement_pending to the database."""
    from database import SessionLocal
    from models import Transaction

    transactions = _statement_pending.get(uid)
    if not transactions:
        await update.message.reply_text("Nothing pending. Send me a bank statement first.")
        return

    db = SessionLocal()
    saved = 0
    skipped = 0
    try:
        for t in transactions:
            sha = hashlib.sha256(
                json.dumps(t, sort_keys=True).encode()
            ).hexdigest()
            # Skip duplicates
            if db.query(Transaction).filter(Transaction.sha256_hash == sha).first():
                skipped += 1
                continue
            txn = Transaction(
                sha256_hash=sha,
                amount=_safe_amount(t.get("amount")),
                currency=t.get("currency", "INR"),
                direction=t.get("direction") or "debit",
                vendor=t.get("vendor") or "",
                bank=t.get("bank"),
                account_last4=t.get("account_last4"),
                date=t.get("date") or datetime.utcnow().strftime("%Y-%m-%d"),
                upi_ref=t.get("upi_ref"),
                category=t.get("category") or "Miscellaneous",
                raw_text=(t.get("raw_text") or "")[:500],
                source_type=t.get("source_type") or "bank_statement",
                notes=t.get("notes"),
                payment_method=t.get("payment_method"),
            )
            db.add(txn)
            saved += 1

        db.commit()
        del _statement_pending[uid]

        msg = f"Saved {saved} transactions from bank statement."
        if skipped:
            msg += f" ({skipped} duplicates skipped)"
        await update.message.reply_text(msg)

    except Exception as e:
        logger.exception("Statement save failed")
        await update.message.reply_text(f"Couldn't save transactions: {e}")
    finally:
        db.close()


async def _route_text(update, context, text: str):
    """Decide whether text is a finance question or a new transaction SMS."""
    # Quick heuristic first — question words / patterns
    lower = text.lower()
    question_signals = (
        lower.startswith(("how", "what", "show", "tell", "give", "how much",
                          "can you", "do i", "am i", "list", "summary",
                          "breakdown", "budget", "spent", "left", "remaining",
                          "investment", "portfolio", "top", "report")) or
        lower.endswith("?") or
        any(w in lower for w in ("this month", "last month", "this week",
                                  "how much", "total", "balance", "overview",
                                  "breakdown", "my budget", "category"))
    )

    if question_signals:
        thinking = await update.message.reply_text("Let me check...")
        try:
            answer = await _answer_question(text)
            await thinking.delete()
            await update.message.reply_text(answer)
        except Exception as e:
            logger.exception("Question answering failed")
            try:
                await thinking.delete()
            except Exception:
                pass
            await update.message.reply_text(f"Couldn't fetch that: {e}")
    else:
        # Treat as new transaction SMS
        await _extract_and_reply(update, context, text=text)


def build_application():
    from telegram.ext import (
        Application, CommandHandler, MessageHandler, filters
    )

    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return None

    allowed_id = os.getenv("TELEGRAM_ALLOWED_USER_ID", "").strip()
    allowed_uid = int(allowed_id) if allowed_id.isdigit() else None

    app = Application.builder().token(token).build()

    def guard(uid):
        return allowed_uid is None or uid == allowed_uid

    async def cmd_start(update, context):
        if not guard(update.effective_user.id):
            return
        await update.message.reply_text(
            "Hi! I'm your personal finance assistant.\n\n"
            "LOG EXPENSES\n"
            "  - Paste or forward a UPI SMS\n"
            "  - Send a photo of a receipt or invoice\n"
            "  - Send a PDF payslip or invoice\n"
            "  Correct anything in plain English before saving.\n\n"
            "ASK QUESTIONS\n"
            "  - How much have I spent this month?\n"
            "  - How much is left in my Food budget?\n"
            "  - What are my top expenses?\n"
            "  - How are my investments doing?\n"
            "  - Give me a summary\n\n"
            "Just type naturally — I'll figure out what you need."
        )

    async def cmd_cancel(update, context):
        uid = update.effective_user.id
        if not guard(uid):
            return
        if uid in _pending:
            del _pending[uid]
            await update.message.reply_text("Cancelled. Nothing was saved.")
        else:
            await update.message.reply_text("Nothing pending right now.")

    async def handle_text(update, context):
        uid = update.effective_user.id
        if not guard(uid):
            logger.warning(f"Blocked message from unauthorised user {uid}")
            return

        text = (update.message.text or "").strip()
        lower = text.lower()

        # ── PDF type disambiguation ──────────────────────────────────────────
        if uid in _pdf_pending:
            if any(w in lower for w in ("statement", "bank", "all", "multiple", "many", "month")):
                pdf_bytes = _pdf_pending.pop(uid)
                await _process_bank_statement(update, context, pdf_bytes)
            elif any(w in lower for w in ("invoice", "receipt", "single", "one", "payslip", "salary")):
                pdf_bytes = _pdf_pending.pop(uid)
                await _extract_and_reply(update, context, image_bytes=pdf_bytes, mime_type="application/pdf", filename="document.pdf")
            else:
                await update.message.reply_text(
                    "Please reply:\n  statement  — to extract all transactions\n  invoice  — to log a single receipt/payslip"
                )
            return

        # ── Bank statement bulk confirm ──────────────────────────────────────
        if uid in _statement_pending:
            if any(w in lower for w in ("ok", "save", "yes", "confirm", "all", "yep", "yup", "yeah", "done")):
                await _save_statement(uid, update)
            elif any(w in lower for w in ("cancel", "no", "nope", "discard")):
                del _statement_pending[uid]
                await update.message.reply_text("Cancelled. Nothing saved.")
            else:
                txns = _statement_pending[uid]
                await update.message.reply_text(
                    f"{len(txns)} transactions ready.\nReply ok to save all, or cancel to discard."
                )
            return

        # Save confirmation
        if lower in ("ok", "save", "yes", "confirm", "looks good", "correct",
                     "yep", "yup", "yeah", "done", "log it", "save it"):
            await _save_pending(uid, update)
            return

        # Cancel
        if lower in ("cancel", "no", "nope", "discard", "bin it", "delete"):
            if uid in _pending:
                del _pending[uid]
            await update.message.reply_text("Cancelled. Nothing saved.")
            return

        # Correction via Claude (if there's a pending transaction)
        if uid in _pending:
            thinking = await update.message.reply_text("Updating...")
            try:
                categories, _ = await _get_ai_context()
                updated, _ = await _apply_correction(
                    _pending[uid]["extracted"], text, categories
                )
                _pending[uid]["extracted"] = updated
                await thinking.delete()
                await update.message.reply_text(
                    f"Updated!\n\n{_fmt(updated)}\n\n"
                    f"Reply ok to save, or keep correcting."
                )
            except Exception as e:
                logger.exception("Correction failed")
                try:
                    await thinking.delete()
                except Exception:
                    pass
                await update.message.reply_text(
                    f"Couldn't apply that correction: {e}\n"
                    f"Try again or reply ok to save as-is."
                )
            return

        # No pending transaction — check if it's a question or an SMS
        await _route_text(update, context, text)

    async def handle_photo(update, context):
        uid = update.effective_user.id
        if not guard(uid):
            return
        photo = update.message.photo[-1]
        tg_file = await context.bot.get_file(photo.file_id)
        buf = io.BytesIO()
        await tg_file.download_to_memory(buf)
        await _extract_and_reply(
            update, context,
            image_bytes=buf.getvalue(),
            mime_type="image/jpeg",
            filename="photo.jpg"
        )

    async def handle_document(update, context):
        uid = update.effective_user.id
        if not guard(uid):
            return
        doc = update.message.document
        mime = doc.mime_type or ""
        if not (mime.startswith("image/") or mime == "application/pdf"):
            await update.message.reply_text("Please send a JPG, PNG, or PDF.")
            return
        tg_file = await context.bot.get_file(doc.file_id)
        buf = io.BytesIO()
        await tg_file.download_to_memory(buf)
        pdf_bytes = buf.getvalue()

        # Images always go through single-transaction extraction
        if mime.startswith("image/"):
            await _extract_and_reply(update, context, image_bytes=pdf_bytes, mime_type=mime, filename=doc.file_name or "upload")
            return

        # PDFs: ask whether it's a bank statement or a single document
        _pdf_pending[uid] = pdf_bytes
        await update.message.reply_text(
            f"Got the PDF ({doc.file_name or 'document'}).\n\n"
            "Is this a:\n"
            "  statement  — bank statement with multiple transactions\n"
            "  invoice  — single receipt, invoice, or payslip"
        )

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("cancel", cmd_cancel))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.Document.ALL, handle_document))

    return app


async def run_bot():
    app = build_application()
    if app is None:
        logger.info("TELEGRAM_BOT_TOKEN not set — bot disabled.")
        return

    logger.info("Telegram bot starting...")
    async with app:
        await app.start()
        await app.updater.start_polling(drop_pending_updates=True)
        logger.info("Telegram bot is running.")
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            pass
        finally:
            await app.updater.stop()
            await app.stop()
    logger.info("Telegram bot stopped.")
