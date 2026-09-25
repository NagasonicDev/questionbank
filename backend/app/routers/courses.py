from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas, crud, skill_export
from ..database import get_db

router = APIRouter(prefix="/api/v1/courses", tags=["courses"])


@router.get("", response_model=list[schemas.CourseOut])
def list_courses(db: Session = Depends(get_db)):
    return db.scalars(select(models.Course)).all()


@router.post("", response_model=schemas.CourseFullConfig, status_code=201)
def create_course(payload: schemas.CourseCreate, db: Session = Depends(get_db)):
    course = models.Course(
        name=payload.name,
        description=payload.description,
        subject=payload.subject,
        curriculum=payload.curriculum,
        version_year=payload.version_year,
        allow_multi_classification=payload.allow_multi_classification,
    )
    db.add(course)
    db.flush()  # assign course_id

    for lv in payload.hierarchy:
        db.add(models.CourseLevelDef(course_id=course.course_id, level_index=lv.level_index,
                                      label=lv.label, required=lv.required))
    for d in payload.difficulty_levels:
        db.add(models.DifficultyLevel(course_id=course.course_id, level=d.level, label=d.label))
    for tk in payload.question_types:
        existing = db.get(models.QuestionType, tk)
        if not existing:
            db.add(models.QuestionType(type_key=tk, course_id=None, display_name=tk.replace("_", " ").title()))

    db.commit()
    db.refresh(course)
    return crud.get_course_full_config(db, course)


def _get_course_or_404(db: Session, course_id: str) -> models.Course:
    course = db.get(models.Course, course_id)
    if not course:
        raise HTTPException(404, f"Course {course_id} not found")
    return course


@router.get("/{course_id}", response_model=schemas.CourseFullConfig)
def get_course(course_id: str, db: Session = Depends(get_db)):
    course = _get_course_or_404(db, course_id)
    return crud.get_course_full_config(db, course)


@router.patch("/{course_id}", response_model=schemas.CourseOut)
def update_course(course_id: str, payload: schemas.CourseUpdate, db: Session = Depends(get_db)):
    course = _get_course_or_404(db, course_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    return course


@router.delete("/{course_id}", status_code=204)
def delete_course(course_id: str, db: Session = Depends(get_db)):
    course = _get_course_or_404(db, course_id)
    db.delete(course)
    db.commit()


# ---------- Hierarchy levels ----------

@router.post("/{course_id}/levels", response_model=schemas.LevelDefIn, status_code=201)
def add_level(course_id: str, payload: schemas.LevelDefIn, db: Session = Depends(get_db)):
    _get_course_or_404(db, course_id)
    existing = db.get(models.CourseLevelDef, (course_id, payload.level_index))
    if existing:
        raise HTTPException(400, f"Level index {payload.level_index} already exists")
    db.add(models.CourseLevelDef(course_id=course_id, level_index=payload.level_index,
                                  label=payload.label, required=payload.required))
    db.commit()
    return payload


@router.patch("/{course_id}/levels/{level_index}", response_model=schemas.LevelDefIn)
def rename_level(course_id: str, level_index: int, payload: schemas.LevelDefIn, db: Session = Depends(get_db)):
    level = db.get(models.CourseLevelDef, (course_id, level_index))
    if not level:
        raise HTTPException(404, "Level not found")
    level.label = payload.label
    level.required = payload.required
    db.commit()
    return payload


@router.delete("/{course_id}/levels/{level_index}", status_code=204)
def delete_level(course_id: str, level_index: int, db: Session = Depends(get_db)):
    level = db.get(models.CourseLevelDef, (course_id, level_index))
    if not level:
        raise HTTPException(404, "Level not found")
    in_use = db.scalar(
        select(models.CourseNode).where(
            models.CourseNode.course_id == course_id, models.CourseNode.level_index == level_index
        )
    )
    if in_use:
        raise HTTPException(
            400, "Cannot delete a level that still has categories. Reassign or delete them first."
        )
    db.delete(level)
    db.commit()


# ---------- Nodes (topics / dot points / etc.) ----------

@router.get("/{course_id}/nodes", response_model=list[schemas.CourseNodeOut])
def list_nodes(course_id: str, db: Session = Depends(get_db)):
    _get_course_or_404(db, course_id)
    nodes = db.scalars(select(models.CourseNode).where(models.CourseNode.course_id == course_id)).all()
    return crud.build_node_tree(nodes)


@router.post("/{course_id}/nodes", response_model=schemas.CourseNodeOut, status_code=201)
def create_node(course_id: str, payload: schemas.CourseNodeIn, db: Session = Depends(get_db)):
    _get_course_or_404(db, course_id)
    node = models.CourseNode(course_id=course_id, **payload.model_dump())
    db.add(node)
    db.commit()
    db.refresh(node)
    return schemas.CourseNodeOut(
        node_id=node.node_id, course_id=node.course_id, parent_node_id=node.parent_node_id,
        level_index=node.level_index, name=node.name, code=node.code,
        description=node.description, sort_order=node.sort_order, children=[],
    )


@router.patch("/{course_id}/nodes/{node_id}", response_model=schemas.CourseNodeOut)
def update_node(course_id: str, node_id: str, payload: schemas.CourseNodeUpdate, db: Session = Depends(get_db)):
    node = db.get(models.CourseNode, node_id)
    if not node or node.course_id != course_id:
        raise HTTPException(404, "Node not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(node, field, value)
    db.commit()
    db.refresh(node)
    return schemas.CourseNodeOut(
        node_id=node.node_id, course_id=node.course_id, parent_node_id=node.parent_node_id,
        level_index=node.level_index, name=node.name, code=node.code,
        description=node.description, sort_order=node.sort_order, children=[],
    )


@router.delete("/{course_id}/nodes/{node_id}", status_code=204)
def delete_node(course_id: str, node_id: str, db: Session = Depends(get_db)):
    node = db.get(models.CourseNode, node_id)
    if not node or node.course_id != course_id:
        raise HTTPException(404, "Node not found")
    db.delete(node)  # cascades to children + question_classification rows, never touches question rows
    db.commit()


# ---------- Import instructions document (agent-facing) ----------

def _build_instructions_markdown(config: schemas.CourseFullConfig) -> str:
    lines = [f"# COURSE: {config.name}", f"schema_version: {config.schema_version}", "", "## STRUCTURE"]
    for lv in config.hierarchy:
        lines.append(f"Level {lv.level_index + 1}: {lv.label}" + ("" if lv.required else " (optional)"))
    lines += ["", "## VALID NODES"]

    def walk(nodes: list[schemas.CourseNodeOut], indent: int = 0):
        for n in nodes:
            code = f"{n.code} — " if n.code else ""
            lines.append("  " * indent + f"{code}{n.name}")
            walk(n.children, indent + 1)

    walk(config.nodes)
    lines += ["", "## QUESTION TYPES", ", ".join(config.question_types)]
    lines += ["", "## DIFFICULTY"]
    lines.append(", ".join(f"{d.level} = {d.label}" for d in config.difficulty_levels))
    lines += [
        "", "## CLASSIFICATION RULES",
        f"- Multiple classification allowed: {'yes' if config.allow_multi_classification else 'no'}",
        "- If a question spans multiple nodes, list all applicable node_ids in classification.node_ids",
        "- Set confidence to high/medium/low honestly; never guess a category to force a 'high' rating",
        "- Low-confidence questions are still included, not dropped — see the skill file for full handling",
        "", "## OUTPUT FORMAT",
        "Produce a single JSON file matching the import schema (schema_version 1). Multi-part questions: "
        "emit one parent with shared stem content and children under 'parts', each with its own "
        "marks/content/answer/marking_criteria.",
    ]
    return "\n".join(lines)


@router.get("/{course_id}/instructions")
def get_import_instructions(course_id: str, db: Session = Depends(get_db)):
    course = _get_course_or_404(db, course_id)
    config = crud.get_course_full_config(db, course)
    return {"course_id": course_id, "instructions_markdown": _build_instructions_markdown(config)}


@router.get("/{course_id}/skill")
def download_course_skill(course_id: str, db: Session = Depends(get_db)):
    """Bundles the general document-to-question process with this course's
    specific structure, categories, and marking-guide rules into a single
    downloadable .skill file (a zip). See skill_export.py for the contents.
    """
    course = _get_course_or_404(db, course_id)
    config = crud.get_course_full_config(db, course)
    instructions_markdown = _build_instructions_markdown(config)
    data = skill_export.build_skill_zip(config, instructions_markdown)

    slug = "".join(c if c.isalnum() else "-" for c in course.name.lower()).strip("-")
    filename = f"{slug or course_id}.skill"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
