import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlmodel import Session, text

from app.database import create_db_and_tables, get_session
from app.routers import auth, admin, apps, webhooks, monitors
from app.services.monitors import monitor_scheduler_loop


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_db_and_tables()
    stop_event = asyncio.Event()
    task = asyncio.create_task(monitor_scheduler_loop(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Signal — Corporate SMS Notification Gateway", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(apps.router)
app.include_router(monitors.router)
app.include_router(webhooks.router)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/readyz")
def readyz(session: Session = Depends(get_session)):
    session.exec(text("SELECT 1"))
    return {"status": "ready"}


# Serve built React frontend in container (/app/frontend/dist) or local repo (../frontend/dist)
_APP_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIST = (
    _APP_ROOT / "frontend" / "dist"
    if (_APP_ROOT / "frontend" / "dist").exists()
    else _APP_ROOT.parent / "frontend" / "dist"
)
if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
