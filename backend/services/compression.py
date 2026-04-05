import io
import os
from datetime import datetime
from pathlib import Path

from PIL import Image
import pypdf


def get_storage_path() -> Path:
    base = Path(os.getenv("STORAGE_PATH", "~/finance-app/storage")).expanduser()
    return base


def _invoice_dir() -> Path:
    now = datetime.utcnow()
    storage_dir = get_storage_path() / "invoices" / str(now.year) / f"{now.month:02d}"
    storage_dir.mkdir(parents=True, exist_ok=True)
    return storage_dir


def compress_image(image_bytes: bytes, filename: str, sha256_hash: str) -> str:
    """Compress image to JPEG 85% quality, save to storage, return absolute path."""
    storage_dir = _invoice_dir()
    safe_filename = f"{sha256_hash[:12]}_{Path(filename).stem}.jpg"
    output_path = storage_dir / safe_filename

    img = Image.open(io.BytesIO(image_bytes))
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    img.save(str(output_path), "JPEG", quality=85, optimize=True)

    return str(output_path)


def compress_pdf(
    pdf_bytes: bytes, filename: str, sha256_hash: str
) -> tuple:
    """
    Compress PDF using pypdf.

    Returns:
        (file_path: str, first_page_image_bytes: bytes | None)
    """
    storage_dir = _invoice_dir()
    safe_filename = f"{sha256_hash[:12]}_{Path(filename).stem}.pdf"
    output_path = storage_dir / safe_filename

    try:
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        writer = pypdf.PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)
        output_bytes = io.BytesIO()
        writer.write(output_bytes)
        compressed = output_bytes.getvalue()
        # Only use compressed if it is actually smaller
        final_bytes = compressed if len(compressed) < len(pdf_bytes) else pdf_bytes
    except Exception:
        final_bytes = pdf_bytes

    with open(str(output_path), "wb") as f:
        f.write(final_bytes)

    # Convert first page to JPEG for AI extraction
    try:
        from pdf2image import convert_from_bytes  # type: ignore

        images = convert_from_bytes(pdf_bytes, first_page=1, last_page=1, dpi=150)
        if images:
            img_bytes_io = io.BytesIO()
            images[0].save(img_bytes_io, format="JPEG", quality=85)
            return str(output_path), img_bytes_io.getvalue()
    except Exception:
        pass

    return str(output_path), None
