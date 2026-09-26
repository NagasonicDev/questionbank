import json
import mimetypes
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.orm import Session, selectinload

from . import models, schemas
from .database import UPLOADS_DIR, ASSETS_DIR


def hydrated_question_query():
    """Select(Question) with every relationship needed to fully render a
    question (content blocks, classifications, tags, assets, source, and
    child parts) eagerly loaded. Shared by the question API and the test
    generator so both render questions identically.
    """
    return select(models.Question).options(
        selectinload(models.Question.content_blocks),
        selectinload(models.Question.classifications),
        selectinload(models.Question.tags).selectinload(models.QuestionTag.tag),
        selectinload(models.Question.assets),
        selectinload(models.Question.source),
        selectinload(models.Question.children).selectinload(models.Question.content_blocks),
        selectinload(models.Question.children).selectinload(models.Question.classifications),
        selectinload(models.Question.children).selectinload(models.Question.tags).selectinload(models.QuestionTag.tag),
        selectinload(models.Question.children).selectinload(models.Question.assets),
        selectinload(models.Question.children).selectinload(models.Question.source),
    )


# ===================== Course config assembly =====================

def _node_to_out(node: models.CourseNode, by_parent: dict[str | None, list[models.CourseNode]]) -> schemas.CourseNodeOut:
    children = by_parent.get(node.node_id, [])
    return schemas.CourseNodeOut(
        node_id=node.node_id,
        course_id=node.course_id,
        parent_node_id=node.parent_node_id,
        level_index=node.level_index,
        name=node.name,
        code=node.code,
        description=node.description,
        sort_order=node.sort_order,
        children=[_node_to_out(c, by_parent) for c in sorted(children, key=lambda n: n.sort_order)],
    )


def build_node_tree(nodes: list[models.CourseNode]) -> list[schemas.CourseNodeOut]:
    by_parent: dict[str | None, list[models.CourseNode]] = {}
    for n in nodes:
        by_parent.setdefault(n.parent_node_id, []).append(n)
    roots = sorted(by_parent.get(None, []), key=lambda n: n.sort_order)
    return [_node_to_out(r, by_parent) for r in roots]


def get_course_full_config(db: Session, course: models.Course) -> schemas.CourseFullConfig:
    nodes = db.scalars(select(models.CourseNode).where(models.CourseNode.course_id == course.course_id)).all()
    qtypes = db.scalars(
        select(models.QuestionType).where(
            (models.QuestionType.course_id == course.course_id) | (models.QuestionType.course_id.is_(None))
        )
    ).all()
    tags = db.scalars(select(models.Tag).where(models.Tag.course_id == course.course_id)).all()
    return schemas.CourseFullConfig(
        course_id=course.course_id,
        name=course.name,
        schema_version=course.schema_version,
        hierarchy=[
            schemas.LevelDefIn(level_index=lv.level_index, label=lv.label, required=lv.required)
            for lv in course.levels
        ],
        allow_multi_classification=course.allow_multi_classification,
        difficulty_levels=[
            schemas.DifficultyLevelIn(level=d.level, label=d.label) for d in course.difficulty_levels
        ],
        question_types=[qt.type_key for qt in qtypes],
        tags=[t.name for t in tags],
        nodes=build_node_tree(nodes),
    )


# ===================== Question assembly =====================

def _blocks_out(blocks: list[models.ContentBlock], slot: str) -> list[schemas.ContentBlockOut]:
    out = []
    for b in blocks:
        if b.slot != slot:
            continue
        out.append(
            schemas.ContentBlockOut(
                block_id=b.block_id, slot=b.slot, position=b.position,
                block_type=b.block_type, content=json.loads(b.content_json),
            )
        )
    return sorted(out, key=lambda x: x.position)


def question_to_out(q: models.Question, include_parts: bool = True) -> schemas.QuestionOut:
    source_out = None
    if q.source:
        source_out = schemas.SourceOut(
            name=q.source.name, year=q.source.year,
            institution=q.source.institution,
            original_question_no=q.source.original_question_no,
        )
    return schemas.QuestionOut(
        question_id=q.question_id,
        course_id=q.course_id,
        type_key=q.type_key,
        difficulty=q.difficulty,
        marks=q.marks,
        parent_question_id=q.parent_question_id,
        part_label=q.part_label,
        notes=q.notes,
        review_status=q.review_status,
        classification_confidence=q.classification_confidence,
        node_ids=[c.node_id for c in q.classifications],
        tags=[qt.tag.name for qt in q.tags],
        body=_blocks_out(q.content_blocks, "body"),
        mcq_options=[schemas.McqOptionOut(
            position=o.position,
            content=[schemas.ContentBlockIn(block_type=b["block_type"], content=b.get("content", {})) for b in json.loads(o.content_json)],
            is_correct=o.is_correct,
        ) for o in q.mcq_options],
        answer=_blocks_out(q.content_blocks, "answer"),
        solution=_blocks_out(q.content_blocks, "solution"),
        marking_criteria=_blocks_out(q.content_blocks, "marking_criteria"),
        assets=[schemas.AssetOut.model_validate(a) for a in q.assets],
        source=source_out,
        parts=[question_to_out(c, include_parts=False) for c in q.children] if include_parts else [],
        created_at=q.created_at,
        updated_at=q.updated_at,
    )


def snippet_from_body(q: models.Question, length: int = 160) -> str:
    for b in sorted(q.content_blocks, key=lambda x: x.position):
        if b.slot != "body":
            continue
        data = json.loads(b.content_json)
        text = data.get("text") or data.get("latex")
        if text:
            text = str(text).strip()
            return (text[:length] + "…") if len(text) > length else text
    return ""


# ===================== Filtering =====================

def apply_question_filters(
    stmt, *, course_id: str, node_ids: list[str] | None, type_key: str | None,
    difficulty_min: int | None, difficulty_max: int | None, tag_name: str | None,
    marks_min: float | None = None, marks_max: float | None = None,
    type_keys: list[str] | None = None, difficulties: list[int] | None = None,
    approved_only: bool = True, whole_questions_only: bool = True,
):
    stmt = stmt.where(models.Question.course_id == course_id)
    if approved_only:
        stmt = stmt.where(models.Question.review_status == "approved")
    if whole_questions_only:
        stmt = stmt.where(models.Question.parent_question_id.is_(None))
    if type_key:
        stmt = stmt.where(models.Question.type_key == type_key)
    if type_keys:
        stmt = stmt.where(models.Question.type_key.in_(type_keys))
    if difficulty_min is not None:
        stmt = stmt.where(models.Question.difficulty >= difficulty_min)
    if difficulty_max is not None:
        stmt = stmt.where(models.Question.difficulty <= difficulty_max)
    if difficulties:
        stmt = stmt.where(models.Question.difficulty.in_(difficulties))
    if marks_min is not None:
        stmt = stmt.where(models.Question.marks >= marks_min)
    if marks_max is not None:
        stmt = stmt.where(models.Question.marks <= marks_max)
    if node_ids:
        stmt = stmt.where(
            models.Question.question_id.in_(
                select(models.QuestionClassification.question_id).where(
                    models.QuestionClassification.node_id.in_(node_ids)
                )
            )
        )
    if tag_name:
        stmt = stmt.where(
            models.Question.question_id.in_(
                select(models.QuestionTag.question_id)
                .join(models.Tag, models.Tag.tag_id == models.QuestionTag.tag_id)
                .where(models.Tag.name == tag_name)
            )
        )
    return stmt


# ===================== Asset finalization =====================

IMAGE_BLOCK_TYPES = {"image", "diagram", "graph"}


def finalize_uploaded_assets(db: Session, question_id: str, blocks: list[models.ContentBlock]) -> None:
    """Move any newly-uploaded staging files into their permanent per-question
    location and create the matching Asset row, rewriting the block's
    asset_path in place. Blocks that already point at a finalized asset (or
    have no asset_path at all) are left untouched. See routers/assets.py for
    the staging half of this flow.
    """
    dest_dir = ASSETS_DIR / question_id
    for block in blocks:
        if block.block_type not in IMAGE_BLOCK_TYPES:
            continue
        content = json.loads(block.content_json)
        asset_path = content.get("asset_path", "")
        if not asset_path.startswith("_uploads/"):
            continue  # not a fresh upload — either empty, or already finalized

        staged_file = UPLOADS_DIR / asset_path.removeprefix("_uploads/")
        if not staged_file.exists():
            continue  # staged file already consumed or missing; leave content as-is

        dest_dir.mkdir(parents=True, exist_ok=True)
        final_name = staged_file.name
        final_path = dest_dir / final_name
        staged_file.replace(final_path)

        relative_path = f"{question_id}/{final_name}"
        mime_type = mimetypes.guess_type(final_name)[0] or "application/octet-stream"

        db.add(models.Asset(
            question_id=question_id,
            file_path=relative_path,
            mime_type=mime_type,
            alt_text=content.get("alt_text"),
            caption=content.get("caption"),
        ))

        content["asset_path"] = relative_path
        block.content_json = json.dumps(content)
        db.add(block)
