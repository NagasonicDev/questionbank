import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session, selectinload

from .. import models, crud
from ..database import get_db

router = APIRouter(prefix="/api/v1/practice", tags=["practice"])


class SessionCreate(BaseModel):
    course_id: str
    filter: dict
    mode: str = "random"  # sequential | random


class AttemptCreate(BaseModel):
    session_id: str | None = None
    question_id: str
    status: str  # seen|completed|flagged|skipped
    correct: bool | None = None
    time_spent_sec: int | None = None
    user_notes: str | None = None


@router.post("/sessions", status_code=201)
def create_session(payload: SessionCreate, db: Session = Depends(get_db)):
    if not db.get(models.Course, payload.course_id):
        raise HTTPException(404, "Course not found")
    session = models.PracticeSession(
        course_id=payload.course_id, filter_json=json.dumps(payload.filter), mode=payload.mode,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"session_id": session.session_id, "course_id": session.course_id, "mode": session.mode}


@router.post("/attempts", status_code=201)
def record_attempt(payload: AttemptCreate, db: Session = Depends(get_db)):
    if not db.get(models.Question, payload.question_id):
        raise HTTPException(404, "Question not found")
    attempt = models.PracticeAttempt(**payload.model_dump())
    db.add(attempt)
    db.commit()
    return {"attempt_id": attempt.attempt_id}


class RecentQuestionItem(BaseModel):
    question_id: str
    course_id: str
    snippet: str
    type_key: str
    status: str
    seen_at: str


@router.get("/recent", response_model=list[RecentQuestionItem])
def recent_questions(course_id: str | None = None, limit: int = 10, db: Session = Depends(get_db)):
    """Most recently seen/completed questions, most recent first, one row per
    question (not per attempt) — backs the "Recent Questions" sidebar and
    gives the person a quick way back into something they were just doing.
    """
    latest_per_question = (
        select(
            models.PracticeAttempt.question_id,
            func.max(models.PracticeAttempt.created_at).label("last_seen"),
        )
        .group_by(models.PracticeAttempt.question_id)
        .subquery()
    )

    stmt = (
        select(models.Question, latest_per_question.c.last_seen)
        .join(latest_per_question, models.Question.question_id == latest_per_question.c.question_id)
        .options(selectinload(models.Question.content_blocks))
        .order_by(latest_per_question.c.last_seen.desc())
        .limit(limit)
    )
    if course_id:
        stmt = stmt.where(models.Question.course_id == course_id)

    results = db.execute(stmt).all()
    items = []
    for q, last_seen in results:
        last_status = db.scalar(
            select(models.PracticeAttempt.status)
            .where(models.PracticeAttempt.question_id == q.question_id)
            .order_by(models.PracticeAttempt.created_at.desc())
            .limit(1)
        )
        items.append(RecentQuestionItem(
            question_id=q.question_id, course_id=q.course_id,
            snippet=crud.snippet_from_body(q, length=90),
            type_key=q.type_key, status=last_status or "seen",
            seen_at=last_seen.isoformat(),
        ))
    return items
