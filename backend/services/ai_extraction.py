import base64
import json
import os
import re

import anthropic

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

SYSTEM_PROMPT = """You are a financial data extraction assistant. Extract transaction data from the provided content and return ONLY valid JSON with no preamble, explanation, or markdown formatting.

DOCUMENT TYPES AND RULES:
- UPI SMS / bank alert: extract amount, vendor/payee, bank, account, UPI ref. direction=debit for "sent/debited/paid", direction=credit for "received/credited".
- Invoice / receipt: extract total amount paid, vendor name, date. direction=debit.
- Payslip / salary slip: extract NET take-home pay as amount (not gross), employer as vendor, pay period end date as date. direction=ALWAYS credit. source_type=payslip. category=Salary.
- Bank statement row: extract as appropriate.

The JSON must have exactly these fields:
{
  "amount": number (always positive, use direction field for debit/credit),
  "currency": "INR",
  "direction": "debit" or "credit",
  "vendor": "string (payee name, merchant, or employer)",
  "bank": "string or null",
  "account_last4": "string or null",
  "date": "YYYY-MM-DD",
  "upi_ref": "string or null",
  "category": "string — MUST be exactly one of the Available categories listed in the context. Never invent a new category. Use 'Miscellaneous' if nothing fits.",
  "payment_method": "one of: upi | debit_card | credit_card | net_banking | cash | unknown",
  "raw_text": "string (brief one-line summary — keep under 200 chars)",
  "source_type": "upi_sms | invoice_image | invoice_pdf | payslip | manual"
}

CATEGORY RULES:
- You MUST use one of the exact category strings from the Available categories list provided in the context.
- Do NOT use any category name that is not in that list.
- If no category fits well, use "Miscellaneous".
- For payslips/salary, use "Salary".

PAYMENT METHOD RULES:
- "upi" — UPI transfer (VPA/UPI ID mentioned, or "UPI" in text)
- "credit_card" — credit card charge (look for "credit card", "CC", "HDFC CC", "credit limit", etc.)
- "debit_card" — debit/ATM card transaction
- "net_banking" — NEFT / RTGS / IMPS / net banking transfers
- "cash" — cash withdrawal or cash payment
- "unknown" — if you cannot determine the method

Keep raw_text short (under 200 characters). If you cannot extract a required field with confidence, use null for optional fields or sensible defaults."""


def _repair_truncated(raw: str) -> str:
    """Best-effort repair of a truncated JSON string."""
    repaired = re.sub(r",\s*$", "", raw.strip())
    # Close any open string
    if repaired.count('"') % 2 != 0:
        repaired += '"'
    open_brackets = repaired.count('[') - repaired.count(']')
    open_braces   = repaired.count('{') - repaired.count('}')
    repaired += '}' * open_braces + ']' * open_brackets
    return repaired


def _parse_json_safe(raw: str) -> dict:
    """
    Parse a single transaction JSON object from Claude's response.
    - Strips markdown fences
    - If Claude returned an array, takes the first element
    - If truncated, attempts repair
    """
    raw = raw.strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)
    raw = raw.strip()

    # Try direct parse
    try:
        result = json.loads(raw)
        # If Claude returned an array, take the first item
        if isinstance(result, list):
            return result[0] if result else {}
        return result
    except json.JSONDecodeError:
        pass

    # Try repair
    try:
        result = json.loads(_repair_truncated(raw))
        if isinstance(result, list):
            return result[0] if result else {}
        return result
    except json.JSONDecodeError:
        pass

    # Last resort: extract first complete {} object
    match = re.search(r'\{.*?\}', raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse Claude response as JSON.\nRaw: {raw[:400]}")


def _parse_json_array_safe(raw: str) -> list:
    """Same as _parse_json_safe but expects a JSON array."""
    raw = raw.strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)
    raw = raw.strip()

    try:
        result = json.loads(raw)
        return result if isinstance(result, list) else []
    except json.JSONDecodeError:
        # Try to extract whatever complete objects we can
        objects = []
        for match in re.finditer(r'\{[^{}]*\}', raw, re.DOTALL):
            try:
                objects.append(json.loads(match.group()))
            except json.JSONDecodeError:
                continue
        if objects:
            return objects
        # Try repair
        repaired = re.sub(r",\s*$", "", raw.strip())
        if not repaired.endswith(']'):
            if repaired.count('{') > repaired.count('}'):
                repaired += '}'
            repaired += ']'
        try:
            result = json.loads(repaired)
            return result if isinstance(result, list) else []
        except json.JSONDecodeError:
            return []


async def extract_from_text(text: str, vendor_mappings: list, categories: list) -> dict:
    """Extract transaction data from a UPI SMS or plain text."""
    context = (
        f"\nAvailable categories: {', '.join(categories)}"
        f"\nVendor mappings: {json.dumps(vendor_mappings)}"
    )
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=SYSTEM_PROMPT + context,
        messages=[{"role": "user", "content": f"Extract transaction data from this text: {text}"}],
    )
    return _parse_json_safe(response.content[0].text)


async def extract_from_image(
    image_bytes: bytes,
    mime_type: str,
    vendor_mappings: list,
    categories: list,
    source_type: str = "invoice_image",
) -> dict:
    """Extract transaction data from an image (screenshot or scanned invoice)."""
    image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
    context = (
        f"\nAvailable categories: {', '.join(categories)}"
        f"\nVendor mappings: {json.dumps(vendor_mappings)}"
    )
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=SYSTEM_PROMPT + context,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime_type, "data": image_b64}},
                {"type": "text", "text": f"Extract transaction data from this {source_type}. Return only JSON."},
            ],
        }],
    )
    return _parse_json_safe(response.content[0].text)


# Alias used by webhook router
async def extract_from_pdf_image(
    image_bytes: bytes,
    vendor_mappings: list,
    categories: list,
) -> dict:
    return await extract_from_image(
        image_bytes, "image/jpeg", vendor_mappings, categories, source_type="invoice_pdf"
    )


async def suggest_categories() -> list:
    """Ask Claude to suggest expense categories for an Indian urban professional."""
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        messages=[{"role": "user", "content": (
            "Generate a JSON array of 15 expense category names for an Indian urban "
            "professional's personal finance app. Return ONLY a JSON array of strings, "
            "no other text. Include: Food & Dining, Groceries, Transport, Fuel, "
            "Utilities, Rent, Entertainment, Shopping, Health, Subscriptions, "
            "Investments, Miscellaneous, and 3 more relevant ones."
        )}],
    )
    return _parse_json_array_safe(response.content[0].text) or [
        "Food & Dining", "Groceries", "Transport", "Fuel", "Utilities",
        "Rent", "Entertainment", "Shopping", "Health", "Subscriptions",
        "Investments", "Miscellaneous",
    ]


async def extract_bank_statement(
    pdf_bytes: bytes,
    vendor_mappings: list,
    categories: list,
) -> list[dict]:
    """
    Extract all individual transactions from a bank statement PDF.
    Tries pypdf text extraction first (fast, works for digital PDFs).
    Falls back to Claude vision on each page for scanned PDFs.
    """
    import io as _io
    import pypdf

    STATEMENT_SYSTEM = """You are a bank statement parser. Extract every transaction from the provided content and return ONLY a valid JSON array of transaction objects. No preamble, no markdown.

Each transaction object must have exactly these fields:
{
  "amount": number (always positive),
  "currency": "INR",
  "direction": "debit" or "credit",
  "vendor": "string (payee/merchant name, cleaned up)",
  "bank": "string or null",
  "account_last4": "string or null",
  "date": "YYYY-MM-DD",
  "upi_ref": "string or null",
  "category": "string — MUST be exactly one of the Available categories listed below. Never invent a category name.",
  "payment_method": "one of: upi | debit_card | credit_card | net_banking | cash | unknown",
  "raw_text": "original row text (keep under 200 chars)",
  "source_type": "bank_statement"
}

Rules:
- Skip opening/closing balance rows, summary rows, and header rows
- For salary credits use category "Salary", for UPI payments use the payee name as vendor
- Use vendor mappings to assign categories where possible; if a vendor keyword matches, use that category exactly
- The category field MUST be one of the exact strings from the Available categories list. Use "Miscellaneous" if nothing fits.
- If date year is ambiguous, infer from context
- Return [] if no transactions found"""

    context = (
        f"\nAvailable categories: {', '.join(categories)}"
        f"\nVendor mappings: {json.dumps(vendor_mappings)}"
    )

    # --- Try text extraction first ---
    text = ""
    try:
        reader = pypdf.PdfReader(_io.BytesIO(pdf_bytes))
        pages_text = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(t for t in pages_text if t.strip()).strip()
    except Exception:
        pass

    if text and len(text) > 100:
        # Chunk if very long (>60k chars to leave room for response)
        chunks = [text[i:i + 60000] for i in range(0, len(text), 60000)]
        all_transactions = []
        for chunk in chunks:
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=8096,
                system=STATEMENT_SYSTEM + context,
                messages=[{"role": "user", "content": f"Extract all transactions from this bank statement text:\n\n{chunk}"}],
            )
            all_transactions.extend(_parse_json_array_safe(response.content[0].text))
        return all_transactions

    # --- Fallback: vision on each page ---
    try:
        from pdf2image import convert_from_bytes
        images = convert_from_bytes(pdf_bytes, dpi=150)
    except Exception as e:
        raise ValueError(f"Could not read PDF (no text layer, pdf2image failed): {e}")

    all_transactions = []
    for i, img in enumerate(images):
        img_io = _io.BytesIO()
        img.save(img_io, format="JPEG", quality=85)
        img_b64 = base64.standard_b64encode(img_io.getvalue()).decode()

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8096,
            system=STATEMENT_SYSTEM + context,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img_b64}},
                {"type": "text", "text": f"Extract all transactions from page {i + 1} of this bank statement. Return JSON array only."},
            ]}],
        )
        all_transactions.extend(_parse_json_array_safe(response.content[0].text))

    return all_transactions
