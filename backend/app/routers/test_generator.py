import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, exam_export
from ..database import get_db, EXPORTS_DIR

router = APIRouter(prefix="/api/v1", tags=["test-generator"])


class TestSectionIn(BaseModel):
    """One configurable building block of a test paper.

    Exactly one of `count` (pick this many questions) or `marks` (pick
    questions of the section's type/filters totalling this many marks) must
    be set. A section can be narrowed to a single question type
    ("15 multiple choice questions"), given a set of allowed `type_keys` /
    `difficulties` (the multi-select question-bank filters), or left as
    "any" type sharing the request-level node/topic filters.
    """
    name: str | None = None
    node_ids: list[str] = Field(default_factory=list)
    type_key: str | None = None
    type_keys: list[str] = Field(default_factory=list)
    difficulty_min: int | None = None
    difficulty_max: int | None = None
    difficulties: list[int] = Field(default_factory=list)
    marks_min: float | None = None
    marks_max: float | None = None
    count: int | None = Field(default=None, ge=1)
    marks: float | None = Field(default=None, gt=0)


class TestGenerateRequest(BaseModel):
    title: str | None = None
    # Legacy flat fields — still honoured (as a single marks-based section)
    # for anyone calling the old single-target API shape.
    node_ids: list[str] = Field(default_factory=list)
    type_key: str | None = None
    difficulty_min: int | None = None
    difficulty_max: int | None = None
    target_marks: float | None = None
    format: Literal["docx", "pdf"] = "docx"
    shuffle: bool = True
    sections: list[TestSectionIn] | None = None


class TestSectionResult(BaseModel):
    name: str
    question_count: int
    marks: float
    count_requested: int | None = None
    marks_requested: float | None = None


class TestGenerateResponse(BaseModel):
    test_id: str
    title: str
    format: str
    target_marks: float
    achieved_marks: float
    question_count: int
    created_at: str
    test_download_url: str
    solutions_download_url: str
    preview_url: str
    section_results: list[TestSectionResult] = Field(default_factory=list)


def _test_to_response(t: models.GeneratedTest) -> TestGenerateResponse:
    return TestGenerateResponse(
        test_id=t.test_id, title=t.title, format=t.format, target_marks=t.target_marks,
        achieved_marks=t.achieved_marks, question_count=t.question_count,
        created_at=t.created_at.isoformat(),
        test_download_url=f"/api/v1/tests/{t.test_id}/download?which=test",
        solutions_download_url=f"/api/v1/tests/{t.test_id}/download?which=solutions",
        preview_url=f"/api/v1/tests/{t.test_id}/preview",
    )


def _section_label(index: int, section: TestSectionIn, single: bool) -> str | None:
    """Section heading text: explicit name wins; otherwise a default "Section
    A/B/…". Returns None for the implicit single section so the legacy
    one-target flow renders exactly as before (no section heading)."""
    if section.name:
        return section.name
    if single:
        return None
    return f"Section {chr(ord('A') + index)}"


@router.post("/courses/{course_id}/generate-test", response_model=TestGenerateResponse)
def generate_test(course_id: str, payload: TestGenerateRequest, db: Session = Depends(get_db)):
    course = db.get(models.Course, course_id)
    if not course:
        raise HTTPException(404, "Course not found")

    # Build the section list: explicit sections win, else fall back to the
    # legacy single marks target.
    if payload.sections:
        sections = payload.sections
        single = len(sections) == 1
    else:
        if payload.target_marks is None or payload.target_marks <= 0:
            raise HTTPException(400, "target_marks must be greater than 0")
        sections = [TestSectionIn(
            name=None, node_ids=payload.node_ids, type_key=payload.type_key,
            difficulty_min=payload.difficulty_min, difficulty_max=payload.difficulty_max,
            marks=payload.target_marks,
        )]
        single = True

    export_sections: list[tuple[str | None, list[models.Question]]] = []
    section_results: list[TestSectionResult] = []
    all_selected: list[models.Question] = []
    target_total = 0.0

    for index, sec in enumerate(sections):
        if sec.count is None and sec.marks is None:
            raise HTTPException(
                400, f"Section {index + 1}: set either a question count or a marks target."
            )
        name = _section_label(index, sec, single)
        label = name or f"Section {index + 1}"
        node_ids = sec.node_ids or None
        # A section pinned to its own type uses that; otherwise apply the
        # multi-select question-bank type/difficulty filters.
        type_key = sec.type_key
        type_keys = None if sec.type_key else (sec.type_keys or None)
        difficulties = sec.difficulties or None

        if sec.count is not None:
            qs = exam_export.select_n_questions(
                db, course_id=course_id, node_ids=node_ids, type_key=type_key,
                difficulty_min=sec.difficulty_min, difficulty_max=sec.difficulty_max,
                type_keys=type_keys, difficulties=difficulties,
                marks_min=sec.marks_min, marks_max=sec.marks_max,
                count=sec.count, shuffle=payload.shuffle,
            )
        else:
            qs, _ = exam_export.select_questions_for_marks(
                db, course_id=course_id, node_ids=node_ids, type_key=type_key,
                difficulty_min=sec.difficulty_min, difficulty_max=sec.difficulty_max,
                type_keys=type_keys, difficulties=difficulties,
                marks_min=sec.marks_min, marks_max=sec.marks_max,
                target_marks=sec.marks, shuffle=payload.shuffle,
            )
            target_total += sec.marks

        if not qs:
            raise HTTPException(
                400,
                f"No approved questions match {label}. "
                "Try widening the topics/type filters, or set marks on matching questions.",
            )

        sec_marks = round(sum(q.marks or 0 for q in qs), 2)
        export_sections.append((name, qs))
        section_results.append(TestSectionResult(
            name=label, question_count=len(qs), marks=sec_marks,
            count_requested=sec.count, marks_requested=sec.marks,
        ))
        all_selected.extend(qs)

    if not all_selected:
        raise HTTPException(400, "No questions were selected for this test.")

    title = payload.title or f"{course.name} — Practice Test"
    achieved_marks = round(sum(q.marks or 0 for q in all_selected), 2)
    test_id = models.new_id("test")
    test_dir = EXPORTS_DIR / test_id
    test_dir.mkdir(parents=True, exist_ok=True)

    if payload.format == "docx":
        test_bytes = exam_export.build_docx(
            title=title, course_name=course.name, questions=all_selected,
            include_answers=False, sections=export_sections,
        )
        solutions_bytes = exam_export.build_solutions_docx(
            title=title, course_name=course.name, questions=all_selected, sections=export_sections,
        )
        test_ext, solutions_ext = "docx", "docx"
    else:
        test_bytes = exam_export.build_pdf(
            title=title, course_name=course.name, questions=all_selected,
            include_answers=False, sections=export_sections,
        )
        solutions_bytes = exam_export.build_solutions_pdf(
            title=title, course_name=course.name, questions=all_selected, sections=export_sections,
        )
        test_ext, solutions_ext = "pdf", "pdf"

    # The in-app preview is always a PDF regardless of the chosen download
    # format, so it can be embedded in an <iframe> the browser can render
    # natively — reuse the just-built PDF bytes when the format is already
    # PDF instead of building it twice.
    preview_bytes = test_bytes if payload.format == "pdf" else exam_export.build_pdf(
        title=title, course_name=course.name, questions=all_selected,
        include_answers=False, sections=export_sections,
    )

    test_path = test_dir / f"test.{test_ext}"
    solutions_path = test_dir / f"solutions.{solutions_ext}"
    preview_path = test_dir / "preview.pdf"
    test_path.write_bytes(test_bytes)
    solutions_path.write_bytes(solutions_bytes)
    preview_path.write_bytes(preview_bytes)

    record = models.GeneratedTest(
        test_id=test_id, course_id=course_id, title=title, format=payload.format,
        target_marks=target_total, achieved_marks=achieved_marks, question_count=len(all_selected),
        filter_json=json.dumps(payload.model_dump()),
        question_ids_json=json.dumps([q.question_id for q in all_selected]),
        test_file_path=str(test_path.relative_to(EXPORTS_DIR)),
        solutions_file_path=str(solutions_path.relative_to(EXPORTS_DIR)),
        preview_file_path=str(preview_path.relative_to(EXPORTS_DIR)),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    response = _test_to_response(record)
    response.section_results = section_results
    return response


@router.get("/courses/{course_id}/tests", response_model=list[TestGenerateResponse])
def list_tests(course_id: str, limit: int = 20, db: Session = Depends(get_db)):
    rows = db.scalars(
        select(models.GeneratedTest)
        .where(models.GeneratedTest.course_id == course_id)
        .order_by(models.GeneratedTest.created_at.desc())
        .limit(limit)
    ).all()
    return [_test_to_response(r) for r in rows]


def _get_test_or_404(db: Session, test_id: str) -> models.GeneratedTest:
    t = db.get(models.GeneratedTest, test_id)
    if not t:
        raise HTTPException(404, "Test not found")
    return t


@router.get("/tests/{test_id}", response_model=TestGenerateResponse)
def get_test(test_id: str, db: Session = Depends(get_db)):
    return _test_to_response(_get_test_or_404(db, test_id))


MEDIA_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}


@router.get("/tests/{test_id}/download")
def download_test(test_id: str, which: Literal["test", "solutions"] = "test", db: Session = Depends(get_db)):
    t = _get_test_or_404(db, test_id)
    rel_path = t.test_file_path if which == "test" else t.solutions_file_path
    path = EXPORTS_DIR / rel_path
    if not path.exists():
        raise HTTPException(404, "File no longer exists on disk")
    ext = path.suffix.lstrip(".")
    filename = f"{'test' if which == 'test' else 'solutions'}.{ext}"
    return Response(
        content=path.read_bytes(),
        media_type=MEDIA_TYPES.get(ext, "application/octet-stream"),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/tests/{test_id}/preview")
def preview_test(test_id: str, db: Session = Depends(get_db)):
    t = _get_test_or_404(db, test_id)
    path = EXPORTS_DIR / t.preview_file_path
    if not path.exists():
        raise HTTPException(404, "Preview no longer exists on disk")
    return Response(
        content=path.read_bytes(),
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )


@router.delete("/tests/{test_id}", status_code=204)
def delete_test(test_id: str, db: Session = Depends(get_db)):
    t = _get_test_or_404(db, test_id)
    test_dir = (EXPORTS_DIR / t.test_file_path).parent
    db.delete(t)
    db.commit()
    import shutil
    shutil.rmtree(test_dir, ignore_errors=True)
