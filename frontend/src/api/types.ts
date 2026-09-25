export type BlockType =
  | "text" | "heading" | "equation" | "image" | "diagram" | "graph"
  | "table" | "list" | "code" | "answer_area" | "page_break";

export type Slot = "body" | "answer" | "solution" | "marking_criteria";

export interface ContentBlock {
  block_id: string;
  slot: Slot;
  position: number;
  block_type: BlockType;
  content: Record<string, any>;
}

export interface LevelDef {
  level_index: number;
  label: string;
  required: boolean;
}

export interface DifficultyLevel {
  level: number;
  label: string;
}

export interface CourseNode {
  node_id: string;
  course_id: string;
  parent_node_id: string | null;
  level_index: number;
  name: string;
  code: string | null;
  description: string | null;
  sort_order: number;
  children: CourseNode[];
}

export interface CourseFullConfig {
  course_id: string;
  name: string;
  schema_version: number;
  hierarchy: LevelDef[];
  allow_multi_classification: boolean;
  difficulty_levels: DifficultyLevel[];
  question_types: string[];
  tags: string[];
  nodes: CourseNode[];
}

export interface Course {
  course_id: string;
  name: string;
  description: string | null;
  subject: string | null;
  curriculum: string | null;
  version_year: string | null;
  schema_version: number;
  allow_multi_classification: boolean;
  created_at: string;
  updated_at: string;
}

export interface Source {
  name: string;
  year: number | null;
  institution: string | null;
  original_question_no: string | null;
}

export interface Asset {
  asset_id: string;
  file_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
}

export interface Question {
  question_id: string;
  course_id: string;
  type_key: string;
  difficulty: number | null;
  marks: number | null;
  parent_question_id: string | null;
  part_label: string | null;
  notes: string | null;
  review_status: string;
  classification_confidence: string | null;
  node_ids: string[];
  tags: string[];
  body: ContentBlock[];
  answer: ContentBlock[];
  solution: ContentBlock[];
  marking_criteria: ContentBlock[];
  assets: Asset[];
  source: Source | null;
  parts: Question[];
  created_at: string;
  updated_at: string;
}

export interface QuestionListItem {
  question_id: string;
  type_key: string;
  difficulty: number | null;
  marks: number | null;
  snippet: string;
  source: Source | null;
}

export interface QuestionListResponse {
  total: number;
  page: number;
  page_size: number;
  items: QuestionListItem[];
}

export interface RandomQuestionResponse {
  matching_count: number;
  question: Question | null;
}

export interface NodeCount {
  node_id: string;
  name: string;
  level_index: number;
  count: number;
  children: NodeCount[];
}

export interface QuestionCountsResponse {
  total: number;
  by_node: NodeCount[];
  by_type: Record<string, number>;
  by_difficulty: Record<string, number>;
}

export interface PracticeFilters {
  course_id: string;
  node_ids: string[];
  type_key: string | null;
  difficulty_min: number | null;
  difficulty_max: number | null;
  tag: string | null;
  avoid_recent_days: number | null;
}

export interface TestSectionInput {
  name?: string;
  node_ids?: string[];
  type_key?: string | null;
  type_keys?: string[];
  difficulties?: Array<number | string>;
  count?: number | null;
  marks?: number | null;
}

export interface TestSectionResult {
  name: string;
  question_count: number;
  marks: number;
  count_requested: number | null;
  marks_requested: number | null;
}

export interface GeneratedTestMeta {
  test_id: string;
  title: string;
  format: "docx" | "pdf";
  target_marks: number;
  achieved_marks: number;
  question_count: number;
  created_at: string;
  test_download_url: string;
  solutions_download_url: string;
  preview_url: string;
  section_results?: TestSectionResult[];
}

export interface ImportResultItem {
  index: number;
  status: "imported" | "error";
  question_id?: string;
  errors: string[];
  warnings: string[];
}

export interface ImportResponse {
  import_job_id: string;
  imported_count: number;
  error_count: number;
  warnings: string[];
  results: ImportResultItem[];
}
