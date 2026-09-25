"""
ORM models — mirrors §4 of the system design doc.

Design notes:
- Course structure is a generic tree (CourseNode) rather than fixed
  topic/subtopic columns, so any hierarchy shape works without schema change.
- Question content is block-based (ContentBlock) with a `slot` (body/answer/
  solution/marking_criteria) and `position`, preserving in-order sequencing
  of text/equation/image/table content.
- Question <-> CourseNode is many-to-many (QuestionClassification) so a
  question can belong to multiple dot points when a course allows it.
- All PK/FK relationships use stable string IDs, never names, so renaming a
  node never orphans a question.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    String, Text, Integer, Float, ForeignKey, ForeignKeyConstraint,
    UniqueConstraint, Index, DateTime,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def now() -> datetime:
    return datetime.now(timezone.utc)


# ===================== Courses & Structure =====================

class Course(Base):
    __tablename__ = "course"

    course_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("course"))
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    subject: Mapped[str | None] = mapped_column(String)
    curriculum: Mapped[str | None] = mapped_column(String)
    version_year: Mapped[str | None] = mapped_column(String)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    allow_multi_classification: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    levels: Mapped[list["CourseLevelDef"]] = relationship(
        back_populates="course", cascade="all, delete-orphan", order_by="CourseLevelDef.level_index"
    )
    nodes: Mapped[list["CourseNode"]] = relationship(back_populates="course", cascade="all, delete-orphan")
    difficulty_levels: Mapped[list["DifficultyLevel"]] = relationship(
        back_populates="course", cascade="all, delete-orphan", order_by="DifficultyLevel.level"
    )
    tags: Mapped[list["Tag"]] = relationship(back_populates="course", cascade="all, delete-orphan")


class CourseLevelDef(Base):
    __tablename__ = "course_level_def"

    course_id: Mapped[str] = mapped_column(ForeignKey("course.course_id", ondelete="CASCADE"), primary_key=True)
    level_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    required: Mapped[bool] = mapped_column(default=True)

    course: Mapped["Course"] = relationship(back_populates="levels")


class CourseNode(Base):
    __tablename__ = "course_node"

    node_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("node"))
    course_id: Mapped[str] = mapped_column(ForeignKey("course.course_id", ondelete="CASCADE"), nullable=False)
    parent_node_id: Mapped[str | None] = mapped_column(ForeignKey("course_node.node_id", ondelete="CASCADE"))
    level_index: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    course: Mapped["Course"] = relationship(back_populates="nodes")
    children: Mapped[list["CourseNode"]] = relationship(
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="CourseNode.sort_order",
    )
    parent: Mapped["CourseNode | None"] = relationship(remote_side=[node_id], back_populates="children")


Index("idx_course_node_parent", CourseNode.parent_node_id)
Index("idx_course_node_course_level", CourseNode.course_id, CourseNode.level_index)


class DifficultyLevel(Base):
    __tablename__ = "difficulty_level"

    course_id: Mapped[str] = mapped_column(ForeignKey("course.course_id", ondelete="CASCADE"), primary_key=True)
    level: Mapped[int] = mapped_column(Integer, primary_key=True)
    label: Mapped[str] = mapped_column(String, nullable=False)

    course: Mapped["Course"] = relationship(back_populates="difficulty_levels")


class QuestionType(Base):
    __tablename__ = "question_type"

    type_key: Mapped[str] = mapped_column(String, primary_key=True)
    course_id: Mapped[str | None] = mapped_column(ForeignKey("course.course_id", ondelete="CASCADE"))
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    schema_json: Mapped[str | None] = mapped_column(Text)


class Tag(Base):
    __tablename__ = "tag"
    __table_args__ = (UniqueConstraint("course_id", "name", name="uq_tag_course_name"),)

    tag_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("tag"))
    course_id: Mapped[str] = mapped_column(ForeignKey("course.course_id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)

    course: Mapped["Course"] = relationship(back_populates="tags")


# ===================== Sources =====================

class Source(Base):
    __tablename__ = "source"

    source_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("src"))
    name: Mapped[str] = mapped_column(String, nullable=False)
    year: Mapped[int | None] = mapped_column(Integer)
    institution: Mapped[str | None] = mapped_column(String)
    paper: Mapped[str | None] = mapped_column(String)
    original_page: Mapped[int | None] = mapped_column(Integer)
    original_question_no: Mapped[str | None] = mapped_column(String)
    original_filename: Mapped[str | None] = mapped_column(String)
    import_job_id: Mapped[str | None] = mapped_column(String)


# ===================== Questions =====================

class Question(Base):
    __tablename__ = "question"

    question_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("q"))
    course_id: Mapped[str] = mapped_column(ForeignKey("course.course_id"), nullable=False)
    type_key: Mapped[str] = mapped_column(ForeignKey("question_type.type_key"), nullable=False)
    difficulty: Mapped[int | None] = mapped_column(Integer)
    marks: Mapped[float | None] = mapped_column(Float)
    parent_question_id: Mapped[str | None] = mapped_column(ForeignKey("question.question_id", ondelete="CASCADE"))
    part_label: Mapped[str | None] = mapped_column(String)
    source_id: Mapped[str | None] = mapped_column(ForeignKey("source.source_id"))
    notes: Mapped[str | None] = mapped_column(Text)
    review_status: Mapped[str] = mapped_column(String, default="approved")  # pending_review | approved
    classification_confidence: Mapped[str | None] = mapped_column(String)  # high | medium | low
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    content_blocks: Mapped[list["ContentBlock"]] = relationship(
        back_populates="question", cascade="all, delete-orphan",
        order_by="ContentBlock.slot, ContentBlock.position",
    )
    classifications: Mapped[list["QuestionClassification"]] = relationship(
        back_populates="question", cascade="all, delete-orphan"
    )
    tags: Mapped[list["QuestionTag"]] = relationship(back_populates="question", cascade="all, delete-orphan")
    assets: Mapped[list["Asset"]] = relationship(back_populates="question", cascade="all, delete-orphan")
    mcq_options: Mapped[list["McqOption"]] = relationship(
        back_populates="question", cascade="all, delete-orphan", order_by="McqOption.position"
    )
    source: Mapped["Source | None"] = relationship()
    children: Mapped[list["Question"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan", order_by="Question.created_at"
    )
    parent: Mapped["Question | None"] = relationship(remote_side=[question_id], back_populates="children")


Index("idx_question_course", Question.course_id)
Index("idx_question_type", Question.type_key)
Index("idx_question_difficulty", Question.difficulty)
Index("idx_question_parent", Question.parent_question_id)


class ContentBlock(Base):
    __tablename__ = "content_block"

    block_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("blk"))
    question_id: Mapped[str] = mapped_column(ForeignKey("question.question_id", ondelete="CASCADE"), nullable=False)
    slot: Mapped[str] = mapped_column(String, default="body")  # body | answer | solution | marking_criteria
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    block_type: Mapped[str] = mapped_column(String, nullable=False)
    content_json: Mapped[str] = mapped_column(Text, nullable=False)

    question: Mapped["Question"] = relationship(back_populates="content_blocks")


Index("idx_content_block_question", ContentBlock.question_id, ContentBlock.slot, ContentBlock.position)


class QuestionClassification(Base):
    __tablename__ = "question_classification"

    question_id: Mapped[str] = mapped_column(ForeignKey("question.question_id", ondelete="CASCADE"), primary_key=True)
    node_id: Mapped[str] = mapped_column(ForeignKey("course_node.node_id", ondelete="CASCADE"), primary_key=True)
    is_primary: Mapped[bool] = mapped_column(default=False)

    question: Mapped["Question"] = relationship(back_populates="classifications")
    node: Mapped["CourseNode"] = relationship()


Index("idx_qc_node", QuestionClassification.node_id)


class QuestionTag(Base):
    __tablename__ = "question_tag"

    question_id: Mapped[str] = mapped_column(ForeignKey("question.question_id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[str] = mapped_column(ForeignKey("tag.tag_id", ondelete="CASCADE"), primary_key=True)

    question: Mapped["Question"] = relationship(back_populates="tags")
    tag: Mapped["Tag"] = relationship()


class McqOption(Base):
    __tablename__ = "mcq_option"

    option_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("opt"))
    question_id: Mapped[str] = mapped_column(ForeignKey("question.question_id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    content_json: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(default=False)

    question: Mapped["Question"] = relationship(back_populates="mcq_options")


# ===================== Assets =====================

class Asset(Base):
    __tablename__ = "asset"

    asset_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("asset"))
    question_id: Mapped[str] = mapped_column(ForeignKey("question.question_id", ondelete="CASCADE"), nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    alt_text: Mapped[str | None] = mapped_column(String)
    caption: Mapped[str | None] = mapped_column(String)
    original_filename: Mapped[str | None] = mapped_column(String)

    question: Mapped["Question"] = relationship(back_populates="assets")


# ===================== Practice =====================

class PracticeSession(Base):
    __tablename__ = "practice_session"

    session_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("sess"))
    course_id: Mapped[str] = mapped_column(ForeignKey("course.course_id"), nullable=False)
    filter_json: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(String, nullable=False)  # sequential | random
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class PracticeAttempt(Base):
    __tablename__ = "practice_attempt"

    attempt_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("att"))
    session_id: Mapped[str | None] = mapped_column(ForeignKey("practice_session.session_id", ondelete="CASCADE"))
    question_id: Mapped[str] = mapped_column(ForeignKey("question.question_id"), nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)  # seen|completed|flagged|skipped
    correct: Mapped[bool | None] = mapped_column()
    time_spent_sec: Mapped[int | None] = mapped_column(Integer)
    user_notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


Index("idx_attempt_question", PracticeAttempt.question_id, PracticeAttempt.created_at)


# ===================== Import Jobs =====================

class ImportJob(Base):
    __tablename__ = "import_job"

    import_job_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("imp"))
    course_id: Mapped[str] = mapped_column(ForeignKey("course.course_id"), nullable=False)
    source_filename: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, nullable=False)  # processing|ready_for_review|imported|failed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ImportQuestion(Base):
    __tablename__ = "import_question"

    import_question_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("iq"))
    import_job_id: Mapped[str] = mapped_column(ForeignKey("import_job.import_job_id", ondelete="CASCADE"), nullable=False)
    proposed_json: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[str] = mapped_column(String, nullable=False)  # high|medium|low
    resolution: Mapped[str] = mapped_column(String, default="pending")  # pending|approved|edited|rejected
    final_question_id: Mapped[str | None] = mapped_column(ForeignKey("question.question_id"))


# ===================== Generated tests (Test Generator history) =====================

class GeneratedTest(Base):
    """A record of a Test Generator run: what was asked for, what was actually
    selected, and where the resulting files live on disk (a downloadable test
    paper, a separate solutions/marking-guide document, and a PDF used purely
    for the in-app preview regardless of the chosen download format). Lets the
    person revisit and re-download anything they've generated before, from
    either the sidebar or the Test Generator page's "Past Tests" list.
    """
    __tablename__ = "generated_test"

    test_id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("test"))
    course_id: Mapped[str] = mapped_column(ForeignKey("course.course_id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    format: Mapped[str] = mapped_column(String, nullable=False)  # docx | pdf
    target_marks: Mapped[float] = mapped_column(Float, nullable=False)
    achieved_marks: Mapped[float] = mapped_column(Float, nullable=False)
    question_count: Mapped[int] = mapped_column(Integer, nullable=False)
    filter_json: Mapped[str] = mapped_column(Text, nullable=False)
    question_ids_json: Mapped[str] = mapped_column(Text, nullable=False)
    test_file_path: Mapped[str] = mapped_column(String, nullable=False)
    solutions_file_path: Mapped[str] = mapped_column(String, nullable=False)
    preview_file_path: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


Index("idx_generated_test_course", GeneratedTest.course_id, GeneratedTest.created_at)
