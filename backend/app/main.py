from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from . import models
from .database import engine, SessionLocal, ASSETS_DIR
from .routers import courses, questions, practice, assets, test_generator, import_pipeline

BUILTIN_QUESTION_TYPES = [
    ("multiple_choice", "Multiple Choice"),
    ("short_answer", "Short Answer"),
    ("extended_response", "Extended Response"),
]

# The built frontend (npm run build), if present — see the launcher scripts
# at the project root, which build this before starting the server so the
# whole app runs as a single process on a single port.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def seed_builtin_question_types():
    db = SessionLocal()
    try:
        for key, label in BUILTIN_QUESTION_TYPES:
            if not db.get(models.QuestionType, key):
                db.add(models.QuestionType(type_key=key, course_id=None, display_name=label))
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    models.Base.metadata.create_all(bind=engine)
    seed_builtin_question_types()
    yield


app = FastAPI(title="Quaestio", version="0.1.0", lifespan=lifespan)

# CORS is only needed for the separate Vite dev server (npm run dev on
# :5173); the single-process launcher below serves frontend and API from
# the same origin, where no CORS is involved at all.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Question-Count", "X-Total-Marks", "Content-Disposition"],
)

app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")

app.include_router(courses.router)
app.include_router(questions.router)
app.include_router(practice.router)
app.include_router(assets.router)
app.include_router(test_generator.router)
app.include_router(import_pipeline.router)


@app.get("/api/v1/health")
def health():
    return {"status": "ok"}


# ===================== Serve the built frontend (single-process mode) =====================
# Registered last so it only ever catches requests that didn't match one of
# the API routes or mounts above. Vite's JS/CSS bundle lives under
# frontend/dist/app-assets (renamed from its default "assets" specifically
# to avoid colliding with our own /assets mount); everything else falls
# through to index.html so React Router's client-side routes work on a
# hard refresh or a direct link (e.g. /practice).
if FRONTEND_DIST.exists():
    bundle_dir = FRONTEND_DIST / "app-assets"
    if bundle_dir.exists():
        app.mount("/app-assets", StaticFiles(directory=str(bundle_dir)), name="frontend-bundle")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
