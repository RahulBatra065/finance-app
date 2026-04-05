import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from database import init_db
from routers import auth, expenses, investments, setup, webhook
from services.scheduler import start_scheduler

app = FastAPI(title="Finance App", docs_url="/api/docs")

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(webhook.router, prefix="/webhook", tags=["webhook"])
app.include_router(expenses.router, prefix="/expenses", tags=["expenses"])
app.include_router(investments.router, prefix="/investments", tags=["investments"])
app.include_router(setup.router, prefix="/setup", tags=["setup"])

# ---------------------------------------------------------------------------
# Serve frontend SPA (if built)
# ---------------------------------------------------------------------------
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    assets_dir = frontend_dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):  # noqa: ARG001
        index = frontend_dist / "index.html"
        return FileResponse(str(index))


# ---------------------------------------------------------------------------
# Lifecycle events
# ---------------------------------------------------------------------------
_bot_task = None

DEFAULT_CATEGORIES = [
    "Food/Eating Out", "Groceries", "Transport", "Fuel", "Utilities",
    "Rent", "Entertainment", "Shopping", "Health", "Subscriptions",
    "Investments", "Salary", "Insurance", "Education", "Travel",
    "Personal Care", "Miscellaneous",
]


def _seed_categories():
    """Add any missing default categories without touching existing ones."""
    from database import SessionLocal
    from models import Category
    db = SessionLocal()
    try:
        existing = {c.name for c in db.query(Category).all()}
        for name in DEFAULT_CATEGORIES:
            if name not in existing:
                db.add(Category(name=name))
        db.commit()
    finally:
        db.close()


@app.on_event("startup")
async def startup():
    global _bot_task
    init_db()
    _seed_categories()
    start_scheduler(app)
    # Start Telegram bot in background if token is configured
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if token:
        print(f"[bot] Token found, starting Telegram bot...", flush=True)
        from services.telegram_bot import run_bot
        async def _bot_wrapper():
            try:
                await run_bot()
            except Exception as e:
                print(f"[bot] CRASHED: {e}", flush=True)
                import traceback; traceback.print_exc()
        _bot_task = asyncio.create_task(_bot_wrapper())
    else:
        print("[bot] TELEGRAM_BOT_TOKEN not set in .env — bot disabled.", flush=True)

@app.on_event("shutdown")
async def shutdown():
    if _bot_task:
        _bot_task.cancel()
        try:
            await _bot_task
        except asyncio.CancelledError:
            pass


# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):  # noqa: ARG001
    return JSONResponse(status_code=500, content={"error": str(exc)})
