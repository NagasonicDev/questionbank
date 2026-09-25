import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas, crud
from ..database import get_db

router = APIRouter(prefix="/api/v1", tags=["questions"])


def _question_query():
    return crud.hydrated_question_query()


def _get_or_create_tag(db: Session, course_id: str, name: str) -> models.Tag:
    tag = db.scalar(select(models.Tag).where(models.Tag.course_id == course_id, models.Tag.name == name))
    if not tag:
        tag = models.Tag(course_id=course_id, name=name)
        db.add(tag)
        db.flush()
    return tag


def _write_blocks(db: Session, question_id: str, slot: str, blocks: list[schemas.ContentBlockIn]) -> list[models.ContentBlock]:
    created = []
    for i, b in enumerate(blocks):
        block = models.ContentBlock(
            question_id=question_id, slot=slot, position=i,
            block_type=b.block_type, content_json=json.dumps(b.content),
        )
        db.add(block)
        created.append(block)
    return created


@router.post("/questions", response_model=schemas.QuestionOut, status_code=201)
def create_question(payload: schemas.QuestionCreate, db: Session = Depends(get_db)):
    if not db.get(models.Course, payload.course_id):
        raise HTTPException(404, "Course not found")
    if not db.get(models.QuestionType, payload.type_key):
        raise HTTPException(400, f"Unknown question type '{payload.type_key}'")

    source = None
    if payload.source_name:
        source = models.Source(
            name=payload.source_name, year=payload.source_year,
            institution=payload.source_institution,
            original_question_no=payload.source_original_question_no,
        )
        db.add(source)
        db.flush()

    q = models.Question(
        course_id=payload.course_id, type_key=payload.type_key, difficulty=payload.difficulty,
        marks=payload.marks, parent_question_id=payload.parent_question_id, part_label=payload.part_label,
        notes=payload.notes, source_id=source.source_id if source else None,
        review_status=payload.review_status, classification_confidence=payload.classification_confidence,
    )
    db.add(q)
    db.flush()

    for node_id in payload.node_ids:
        db.add(models.QuestionClassification(question_id=q.question_id, node_id=node_id))
    for tag_name in payload.tag_names:
        tag = _get_or_create_tag(db, payload.course_id, tag_name)
        db.add(models.QuestionTag(question_id=q.question_id, tag_id=tag.tag_id))

    body_blocks = _write_blocks(db, q.question_id, "body", payload.body)
    answer_blocks = _write_blocks(db, q.question_id, "answer", payload.answer)
    solution_blocks = _write_blocks(db, q.question_id, "solution", payload.solution)
    marking_blocks = _write_blocks(db, q.question_id, "marking_criteria", payload.marking_criteria)

    for i, opt in enumerate(payload.mcq_options):
        db.add(models.McqOption(
            question_id=q.question_id, position=i,
            content_json=json.dumps([c.model_dump() for c in opt.content]),
            is_correct=opt.is_correct,
        ))

    db.flush()
    crud.finalize_uploaded_assets(
        db, q.question_id, body_blocks + answer_blocks + solution_blocks + marking_blocks
    )
    db.commit()
    q = db.scalar(_question_query().where(models.Question.question_id == q.question_id))
    return crud.question_to_out(q)


@router.get("/questions/{question_id}", response_model=schemas.QuestionOut)
def get_question(question_id: str, db: Session = Depends(get_db)):
    q = db.scalar(_question_query().where(models.Question.question_id == question_id))
    if not q:
        raise HTTPException(404, "Question not found")
    return crud.question_to_out(q)


@router.patch("/questions/{question_id}", response_model=schemas.QuestionOut)
def update_question(question_id: str, payload: schemas.QuestionUpdate, db: Session = Depends(get_db)):
    q = db.get(models.Question, question_id)
    if not q:
        raise HTTPException(404, "Question not found")

    data = payload.model_dump(exclude_unset=True)
    for field in ("type_key", "difficulty", "marks", "notes", "review_status"):
        if field in data:
            setattr(q, field, data[field])

    if "node_ids" in data:
        db.query(models.QuestionClassification).filter_by(question_id=question_id).delete()
        for node_id in data["node_ids"]:
            db.add(models.QuestionClassification(question_id=question_id, node_id=node_id))

    if "tag_names" in data:
        db.query(models.QuestionTag).filter_by(question_id=question_id).delete()
        for tag_name in data["tag_names"]:
            tag = _get_or_create_tag(db, q.course_id, tag_name)
            db.add(models.QuestionTag(question_id=question_id, tag_id=tag.tag_id))

    updated_blocks: list[models.ContentBlock] = []
    for slot in ("body", "answer", "solution", "marking_criteria"):
        if slot in data and data[slot] is not None:
            db.query(models.ContentBlock).filter_by(question_id=question_id, slot=slot).delete()
            updated_blocks += _write_blocks(db, question_id, slot, [schemas.ContentBlockIn(**b) for b in data[slot]])

    db.flush()
    crud.finalize_uploaded_assets(db, question_id, updated_blocks)
    db.commit()
    q = db.scalar(_question_query().where(models.Question.question_id == question_id))
    return crud.question_to_out(q)


@router.delete("/questions/{question_id}", status_code=204)
def delete_question(question_id: str, db: Session = Depends(get_db)):
    q = db.get(models.Question, question_id)
    if not q:
        raise HTTPException(404, "Question not found")
    # practice_attempt.question_id and import_question.final_question_id have no
    # ON DELETE clause, so they must be cleared first or the commit fails with
    # "FOREIGN KEY constraint failed" (the ORM has no relationship to cascade).
    db.query(models.PracticeAttempt).filter_by(question_id=question_id).delete()
    db.query(models.ImportQuestion).filter_by(final_question_id=question_id).update(
        {models.ImportQuestion.final_question_id: None}
    )
    db.delete(q)
    db.commit()


# ===================== Filtering / listing / search =====================

@router.get("/courses/{course_id}/questions", response_model=schemas.QuestionListResponse)
def list_questions(
    course_id: str,
    node_id: list[str] = Query(default=[]),
    type: list[str] = Query(default=[]),
    difficulty: list[int] = Query(default=[]),
    tag: str | None = None,
    q: str | None = Query(default=None, description="free-text search over question body"),
    sort: str = Query(default="created_desc"),
    page: int = 1,
    page_size: int = 25,
    db: Session = Depends(get_db),
):
    base = crud.apply_question_filters(
        select(models.Question), course_id=course_id, node_ids=node_id or None,
        type_key=None, type_keys=type or None,
        difficulty_min=None, difficulty_max=None, difficulties=difficulty or None,
        tag_name=tag,
    )
    if q:
        base = base.where(
            models.Question.question_id.in_(
                select(models.ContentBlock.question_id).where(
                    models.ContentBlock.slot == "body", models.ContentBlock.content_json.like(f"%{q}%")
                )
            )
        )

    total = db.scalar(select(func.count()).select_from(base.subquery()))

    sort_map = {
        "created_desc": models.Question.created_at.desc(),
        "created_asc": models.Question.created_at.asc(),
        "difficulty_asc": models.Question.difficulty.asc(),
        "difficulty_desc": models.Question.difficulty.desc(),
        "random": func.random(),
    }
    order = sort_map.get(sort, models.Question.created_at.desc())

    stmt = (
        _question_query()
        .where(models.Question.question_id.in_(select(base.subquery().c.question_id)))
        .order_by(order)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = db.scalars(stmt).unique().all()
    items = [
        schemas.QuestionListItem(
            question_id=r.question_id, type_key=r.type_key, difficulty=r.difficulty, marks=r.marks,
            snippet=crud.snippet_from_body(r),
            source=schemas.SourceOut(name=r.source.name, year=r.source.year,
                                      institution=r.source.institution,
                                      original_question_no=r.source.original_question_no) if r.source else None,
        )
        for r in rows
    ]
    return schemas.QuestionListResponse(total=total, page=page, page_size=page_size, items=items)


@router.get("/courses/{course_id}/question-counts", response_model=schemas.QuestionCountsResponse)
def question_counts(
    course_id: str,
    type: list[str] = Query(default=[]),
    difficulty: list[int] = Query(default=[]),
    db: Session = Depends(get_db),
):
    base = crud.apply_question_filters(
        select(models.Question.question_id), course_id=course_id, node_ids=None,
        type_key=None, type_keys=type or None,
        difficulty_min=None, difficulty_max=None, difficulties=difficulty or None,
        tag_name=None,
    )
    matching_ids = set(db.scalars(base).all())
    total = len(matching_ids)

    nodes = db.scalars(select(models.CourseNode).where(models.CourseNode.course_id == course_id)).all()
    classifications = db.execute(
        select(models.QuestionClassification.node_id, models.QuestionClassification.question_id)
        .where(models.QuestionClassification.question_id.in_(matching_ids) if matching_ids else False)
    ).all()
    counts_by_node: dict[str, int] = {}
    for node_id, question_id in classifications:
        counts_by_node[node_id] = counts_by_node.get(node_id, 0) + 1

    by_parent: dict[str | None, list[models.CourseNode]] = {}
    for n in nodes:
        by_parent.setdefault(n.parent_node_id, []).append(n)

    def build(node: models.CourseNode) -> schemas.NodeCount:
        children = [build(c) for c in sorted(by_parent.get(node.node_id, []), key=lambda n: n.sort_order)]
        own = counts_by_node.get(node.node_id, 0)
        rollup = own + sum(c.count for c in children)
        return schemas.NodeCount(node_id=node.node_id, name=node.name, level_index=node.level_index,
                                  count=rollup, children=children)

    roots = sorted(by_parent.get(None, []), key=lambda n: n.sort_order)
    by_node = [build(r) for r in roots]

    by_type: dict[str, int] = {}
    by_difficulty: dict[str, int] = {}
    if matching_ids:
        for tk, cnt in db.execute(
            select(models.Question.type_key, func.count())
            .where(models.Question.question_id.in_(matching_ids)).group_by(models.Question.type_key)
        ).all():
            by_type[tk] = cnt
        for diff, cnt in db.execute(
            select(models.Question.difficulty, func.count())
            .where(models.Question.question_id.in_(matching_ids)).group_by(models.Question.difficulty)
        ).all():
            by_difficulty[str(diff)] = cnt

    return schemas.QuestionCountsResponse(total=total, by_node=by_node, by_type=by_type, by_difficulty=by_difficulty)


@router.get("/random-question", response_model=schemas.RandomQuestionResponse)
def random_question(
    course_id: str,
    node_id: list[str] = Query(default=[]),
    type: list[str] = Query(default=[]),
    difficulty: list[int] = Query(default=[]),
    tag: str | None = None,
    exclude_question_ids: list[str] = Query(default=[], description="client-side seen list to avoid immediate repeats"),
    exclude_recent_days: int | None = None,
    db: Session = Depends(get_db),
):
    """The core 'pick filters -> click a button -> get a question' endpoint.

    Stateless by design: no session is created, so the frontend can just
    keep calling this with the same filter state for a 'New Question' button.
    """
    base = crud.apply_question_filters(
        select(models.Question.question_id), course_id=course_id, node_ids=node_id or None,
        type_key=None, type_keys=type or None,
        difficulty_min=None, difficulty_max=None, difficulties=difficulty or None,
        tag_name=tag,
    )
    if exclude_question_ids:
        base = base.where(models.Question.question_id.not_in(exclude_question_ids))
    if exclude_recent_days:
        recent = select(models.PracticeAttempt.question_id).where(
            models.PracticeAttempt.created_at >= func.datetime("now", f"-{exclude_recent_days} days")
        )
        base = base.where(models.Question.question_id.not_in(recent))

    matching_ids = db.scalars(base).all()
    matching_count = len(matching_ids)
    if not matching_ids:
        return schemas.RandomQuestionResponse(matching_count=0, question=None)

    chosen_id = db.scalar(select(models.Question.question_id).where(
        models.Question.question_id.in_(matching_ids)).order_by(func.random()).limit(1))
    q = db.scalar(_question_query().where(models.Question.question_id == chosen_id))
    return schemas.RandomQuestionResponse(matching_count=matching_count, question=crud.question_to_out(q))
