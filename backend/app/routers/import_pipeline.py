"""
Consumes the JSON file produced by the document-to-question skill (see
skill_export.py for what's handed to the agent, and §38-39 of the design doc
for the format this validates against). Each question is validated
independently and reported on independently — a bad question elsewhere in
the file never blocks the good ones, and every rejection says exactly why.
"""
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

router = APIRouter(prefix="/api/v1", tags=["import"])


class ImportBlockIn(BaseModel):
    block_type: str
    content: dict[str, Any] = Field(default_factory=dict)


class ImportPartIn(BaseModel):
    part_label: str
    marks: float | None = None
    body: list[ImportBlockIn] = Field(default_factory=list)
    answer: list[ImportBlockIn] = Field(default_factory=list)
    solution: list[ImportBlockIn] = Field(default_factory=list)
    marking_criteria: list[ImportBlockIn] = Field(default_factory=list)


class ImportSourceIn(BaseModel):
    name: str | None = None
    year: int | None = None
    institution: str | None = None
    original_question_no: str | None = None


class ImportMcqOptionIn(BaseModel):
    content: list[ImportBlockIn] = Field(default_factory=list)
    is_correct: bool = False


class ImportQuestionIn(BaseModel):
    type_key: str
    difficulty: int | None = None
    marks: float | None = None
    node_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    body: list[ImportBlockIn] = Field(default_factory=list)
    mcq_options: list[ImportMcqOptionIn] = Field(default_factory=list)
    answer: list[ImportBlockIn] = Field(default_factory=list)
    solution: list[ImportBlockIn] = Field(default_factory=list)
    marking_criteria: list[ImportBlockIn] = Field(default_factory=list)
    parts: list[ImportPartIn] = Field(default_factory=list)
    classification_confidence: str | None = None
    source: ImportSourceIn | None = None


class ImportFileIn(BaseModel):
    schema_version: int = 1
    course_id: str | None = None
    questions: list[ImportQuestionIn]


class ImportResultItem(BaseModel):
    index: int
    status: str  # "imported" | "error"
    question_id: str | None = None
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ImportResponse(BaseModel):
    import_job_id: str
    imported_count: int
    error_count: int
    results: list[ImportResultItem]


def _validate_question(q: ImportQuestionIn, *, valid_type_keys: set[str], valid_node_ids: set[str],
                        valid_difficulties: set[int]) -> tuple[list[str], list[str]]:
    errors, warnings = [], []

    if q.type_key not in valid_type_keys:
        errors.append(f"Unknown type_key '{q.type_key}'. Valid types: {', '.join(sorted(valid_type_keys))}")
    if q.difficulty is not None and valid_difficulties and q.difficulty not in valid_difficulties:
        errors.append(f"difficulty {q.difficulty} is not one of this course's configured levels: {sorted(valid_difficulties)}")
    bad_nodes = [n for n in q.node_ids if n not in valid_node_ids]
    if bad_nodes:
        errors.append(f"node_ids not found in this course: {bad_nodes}")
    if not q.body:
        errors.append("Question has no body content blocks")

    if not q.marking_criteria and not q.answer and not q.solution:
        warnings.append("No marking guide, answer, or solution provided for this question")
    elif not q.marking_criteria:
        warnings.append("No marking guide (marking_criteria) provided — only answer/solution")

    return errors, warnings


def _write_blocks(db: Session, question_id: str, slot: str, blocks: list[ImportBlockIn]):
    for i, b in enumerate(blocks):
        db.add(models.ContentBlock(
            question_id=question_id, slot=slot, position=i,
            block_type=b.block_type, content_json=json.dumps(b.content),
        ))


def _get_or_create_tag(db: Session, course_id: str, name: str) -> models.Tag:
    tag = db.scalar(select(models.Tag).where(models.Tag.course_id == course_id, models.Tag.name == name))
    if not tag:
        tag = models.Tag(course_id=course_id, name=name)
        db.add(tag)
        db.flush()
    return tag


@router.post("/courses/{course_id}/import-json", response_model=ImportResponse)
def import_json(course_id: str, payload: ImportFileIn, db: Session = Depends(get_db)):
    course = db.get(models.Course, course_id)
    if not course:
        raise HTTPException(404, "Course not found")
    if payload.course_id and payload.course_id != course_id:
        raise HTTPException(
            400,
            f"This file was generated for course '{payload.course_id}', not '{course_id}'. "
            "Re-run the skill against the course you're importing into.",
        )

    valid_type_keys = {
        qt.type_key for qt in db.scalars(
            select(models.QuestionType).where(
                (models.QuestionType.course_id == course_id) | (models.QuestionType.course_id.is_(None))
            )
        ).all()
    }
    valid_node_ids = {n.node_id for n in db.scalars(
        select(models.CourseNode).where(models.CourseNode.course_id == course_id)
    ).all()}
    valid_difficulties = {d.level for d in db.scalars(
        select(models.DifficultyLevel).where(models.DifficultyLevel.course_id == course_id)
    ).all()}

    job = models.ImportJob(course_id=course_id, source_filename="import.json", status="processing")
    db.add(job)
    db.flush()

    results: list[ImportResultItem] = []
    imported = 0

    for index, q in enumerate(payload.questions):
        errors, warnings = _validate_question(
            q, valid_type_keys=valid_type_keys, valid_node_ids=valid_node_ids, valid_difficulties=valid_difficulties
        )
        db.add(models.ImportQuestion(
            import_job_id=job.import_job_id,
            proposed_json=q.model_dump_json(),
            confidence=q.classification_confidence or "medium",
            resolution="rejected" if errors else "approved",
        ))

        if errors:
            results.append(ImportResultItem(index=index, status="error", errors=errors, warnings=warnings))
            continue

        source_row = None
        if q.source and q.source.name:
            source_row = models.Source(
                name=q.source.name, year=q.source.year,
                institution=q.source.institution, original_question_no=q.source.original_question_no,
            )
            db.add(source_row)
            db.flush()

        question = models.Question(
            course_id=course_id, type_key=q.type_key, difficulty=q.difficulty, marks=q.marks,
            source_id=source_row.source_id if source_row else None,
            review_status="approved",
            classification_confidence=q.classification_confidence,
        )
        db.add(question)
        db.flush()

        for node_id in q.node_ids:
            db.add(models.QuestionClassification(question_id=question.question_id, node_id=node_id))
        for tag_name in q.tags:
            tag = _get_or_create_tag(db, course_id, tag_name)
            db.add(models.QuestionTag(question_id=question.question_id, tag_id=tag.tag_id))

        _write_blocks(db, question.question_id, "body", q.body)
        for position, option in enumerate(q.mcq_options):
            db.add(models.McqOption(
                question_id=question.question_id,
                position=position,
                content_json=json.dumps([block.model_dump() for block in option.content]),
                is_correct=option.is_correct,
            ))
        _write_blocks(db, question.question_id, "answer", q.answer)
        _write_blocks(db, question.question_id, "solution", q.solution)
        _write_blocks(db, question.question_id, "marking_criteria", q.marking_criteria)

        for part in q.parts:
            part_q = models.Question(
                course_id=course_id, type_key=q.type_key, marks=part.marks,
                parent_question_id=question.question_id, part_label=part.part_label,
                review_status="approved",
            )
            db.add(part_q)
            db.flush()
            _write_blocks(db, part_q.question_id, "body", part.body)
            _write_blocks(db, part_q.question_id, "answer", part.answer)
            _write_blocks(db, part_q.question_id, "solution", part.solution)
            _write_blocks(db, part_q.question_id, "marking_criteria", part.marking_criteria)

        results.append(ImportResultItem(
            index=index, status="imported", question_id=question.question_id, warnings=warnings
        ))
        imported += 1

    job.status = "imported" if imported else "failed"
    db.commit()

    return ImportResponse(
        import_job_id=job.import_job_id, imported_count=imported,
        error_count=len(payload.questions) - imported, results=results,
    )
