from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

BlockType = Literal[
    "text", "heading", "equation", "image", "diagram", "graph",
    "table", "list", "code", "answer_area", "page_break",
]
Slot = Literal["body", "answer", "solution", "marking_criteria"]


# ===================== Course config =====================

class LevelDefIn(BaseModel):
    level_index: int
    label: str
    required: bool = True


class DifficultyLevelIn(BaseModel):
    level: int
    label: str


class CourseCreate(BaseModel):
    name: str
    description: str | None = None
    subject: str | None = None
    curriculum: str | None = None
    version_year: str | None = None
    allow_multi_classification: bool = True
    hierarchy: list[LevelDefIn] = Field(default_factory=list)
    difficulty_levels: list[DifficultyLevelIn] = Field(
        default_factory=lambda: [
            DifficultyLevelIn(level=1, label="Very Easy"),
            DifficultyLevelIn(level=2, label="Easy"),
            DifficultyLevelIn(level=3, label="Difficult"),
            DifficultyLevelIn(level=4, label="Very Difficult"),
        ]
    )
    question_types: list[str] = Field(
        default_factory=lambda: ["multiple_choice", "short_answer", "extended_response"]
    )


class CourseUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    subject: str | None = None
    curriculum: str | None = None
    version_year: str | None = None
    allow_multi_classification: bool | None = None


class CourseNodeIn(BaseModel):
    parent_node_id: str | None = None
    level_index: int
    name: str
    code: str | None = None
    description: str | None = None
    sort_order: int = 0


class CourseNodeUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    description: str | None = None
    sort_order: int | None = None
    parent_node_id: str | None = None


class CourseNodeOut(BaseModel):
    node_id: str
    course_id: str
    parent_node_id: str | None
    level_index: int
    name: str
    code: str | None
    description: str | None
    sort_order: int
    children: list["CourseNodeOut"] = Field(default_factory=list)

    class Config:
        from_attributes = True


class CourseOut(BaseModel):
    course_id: str
    name: str
    description: str | None
    subject: str | None
    curriculum: str | None
    version_year: str | None
    schema_version: int
    allow_multi_classification: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CourseFullConfig(BaseModel):
    course_id: str
    name: str
    schema_version: int
    hierarchy: list[LevelDefIn]
    allow_multi_classification: bool
    difficulty_levels: list[DifficultyLevelIn]
    question_types: list[str]
    tags: list[str]
    nodes: list[CourseNodeOut]


# ===================== Questions =====================

class ContentBlockIn(BaseModel):
    block_type: BlockType
    content: dict[str, Any]


class McqOptionIn(BaseModel):
    content: list[ContentBlockIn]
    is_correct: bool = False


class QuestionCreate(BaseModel):
    course_id: str
    type_key: str
    difficulty: int | None = None
    marks: float | None = None
    parent_question_id: str | None = None
    part_label: str | None = None
    notes: str | None = None
    node_ids: list[str] = Field(default_factory=list)
    tag_names: list[str] = Field(default_factory=list)
    body: list[ContentBlockIn] = Field(default_factory=list)
    answer: list[ContentBlockIn] = Field(default_factory=list)
    solution: list[ContentBlockIn] = Field(default_factory=list)
    marking_criteria: list[ContentBlockIn] = Field(default_factory=list)
    mcq_options: list[McqOptionIn] = Field(default_factory=list)
    source_name: str | None = None
    source_year: int | None = None
    source_institution: str | None = None
    source_original_question_no: str | None = None
    review_status: Literal["pending_review", "approved"] = "approved"
    classification_confidence: Literal["high", "medium", "low"] | None = None


class QuestionUpdate(BaseModel):
    type_key: str | None = None
    difficulty: int | None = None
    marks: float | None = None
    notes: str | None = None
    node_ids: list[str] | None = None
    tag_names: list[str] | None = None
    body: list[ContentBlockIn] | None = None
    answer: list[ContentBlockIn] | None = None
    solution: list[ContentBlockIn] | None = None
    marking_criteria: list[ContentBlockIn] | None = None
    review_status: Literal["pending_review", "approved"] | None = None


class ContentBlockOut(BaseModel):
    block_id: str
    slot: Slot
    position: int
    block_type: str
    content: dict[str, Any]


class AssetOut(BaseModel):
    asset_id: str
    file_path: str
    mime_type: str
    width: int | None
    height: int | None
    alt_text: str | None
    caption: str | None


class McqOptionOut(BaseModel):
    position: int
    content: list[ContentBlockIn]
    is_correct: bool

    class Config:
        from_attributes = True


class SourceOut(BaseModel):
    name: str
    year: int | None = None
    institution: str | None = None
    original_question_no: str | None = None


class QuestionOut(BaseModel):
    question_id: str
    course_id: str
    type_key: str
    difficulty: int | None
    marks: float | None
    parent_question_id: str | None
    part_label: str | None
    notes: str | None
    review_status: str
    classification_confidence: str | None
    node_ids: list[str]
    tags: list[str]
    body: list[ContentBlockOut]
    mcq_options: list[McqOptionOut] = Field(default_factory=list)
    answer: list[ContentBlockOut]
    solution: list[ContentBlockOut]
    marking_criteria: list[ContentBlockOut]
    assets: list[AssetOut]
    source: SourceOut | None
    parts: list["QuestionOut"] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class QuestionListItem(BaseModel):
    question_id: str
    type_key: str
    difficulty: int | None
    marks: float | None
    snippet: str
    source: SourceOut | None


class QuestionListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[QuestionListItem]


class RandomQuestionResponse(BaseModel):
    matching_count: int
    question: QuestionOut | None


class NodeCount(BaseModel):
    node_id: str
    name: str
    level_index: int
    count: int
    children: list["NodeCount"] = Field(default_factory=list)


class QuestionCountsResponse(BaseModel):
    total: int
    by_node: list[NodeCount]
    by_type: dict[str, int]
    by_difficulty: dict[str, int]
