from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import AppSettings, Category
from services.ai_extraction import suggest_categories

router = APIRouter()

SETUP_COMPLETE_KEY = "setup_complete"


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class SaveCategoriesRequest(BaseModel):
    categories: List[str]


# ---------------------------------------------------------------------------
# Routes (no JWT required – used during initial setup wizard)
# ---------------------------------------------------------------------------

@router.get("/status")
def setup_status(db: Session = Depends(get_db)):
    """Return whether the initial setup wizard has been completed."""
    setting = db.query(AppSettings).filter(AppSettings.key == SETUP_COMPLETE_KEY).first()
    complete = setting is not None and setting.value == "true"
    return {"complete": complete}


@router.post("/complete")
def complete_setup(db: Session = Depends(get_db)):
    """Mark the setup wizard as complete."""
    setting = db.query(AppSettings).filter(AppSettings.key == SETUP_COMPLETE_KEY).first()
    if setting:
        setting.value = "true"
    else:
        setting = AppSettings(key=SETUP_COMPLETE_KEY, value="true")
        db.add(setting)
    db.commit()
    return {"complete": True}


@router.get("/suggest-categories")
async def suggest_categories_route():
    """Ask Claude to suggest expense categories for an Indian urban professional."""
    try:
        categories = await suggest_categories()
        return {"categories": categories}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI suggestion failed: {e}")


@router.post("/save-categories")
def save_categories(
    body: SaveCategoriesRequest,
    db: Session = Depends(get_db),
):
    """
    Persist a list of category names to the database.

    Existing categories with the same name are skipped (no duplicates).
    """
    created = []
    skipped = []
    for name in body.categories:
        name = name.strip()
        if not name:
            continue
        existing = db.query(Category).filter(Category.name == name).first()
        if existing:
            skipped.append(name)
        else:
            cat = Category(name=name)
            db.add(cat)
            created.append(name)

    db.commit()
    return {"created": created, "skipped": skipped}
