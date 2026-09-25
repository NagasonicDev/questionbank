"""
Asset upload — a two-phase flow so images can be attached to a question
that doesn't exist yet (the question form uploads as the user picks a
file, before the question itself is saved):

1. POST /uploads saves the file to a staging directory (/data/assets/_uploads)
   and returns a path immediately servable at /assets/_uploads/{name}. No
   database row is created yet — nothing here is tied to a question.
2. When the question is created/updated (routers/questions.py), any content
   block referencing a staging path is "finalized": the file is moved to
   /data/assets/{question_id}/{name}, a permanent Asset row is created, and
   the block's asset_path is rewritten to the final location. See
   crud.finalize_uploaded_assets.

This keeps the Asset table's question_id NOT NULL constraint (§4/§12 of the
design doc — assets are always owned by a question) while still allowing
"pick an image, then save the question" as a single natural UI flow.
"""
import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException

from ..database import UPLOADS_DIR

router = APIRouter(prefix="/api/v1", tags=["assets"])

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB


@router.post("/uploads")
async def upload_asset(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "File too large (max 15 MB)")

    staged_name = f"upl_{uuid.uuid4().hex[:16]}{ext}"
    dest = UPLOADS_DIR / staged_name
    dest.write_bytes(data)

    return {
        "asset_path": f"_uploads/{staged_name}",
        "mime_type": file.content_type,
        "original_filename": file.filename,
        "size_bytes": len(data),
    }
