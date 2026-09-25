export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS course (
  course_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  subject TEXT,
  curriculum TEXT,
  version_year TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  allow_multi_classification INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_level_def (
  course_id TEXT NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  level_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (course_id, level_index)
);

CREATE TABLE IF NOT EXISTS course_node (
  node_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  parent_node_id TEXT REFERENCES course_node(node_id) ON DELETE CASCADE,
  level_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_course_node_parent ON course_node(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_course_node_course_level ON course_node(course_id, level_index);

CREATE TABLE IF NOT EXISTS difficulty_level (
  course_id TEXT NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (course_id, level)
);

CREATE TABLE IF NOT EXISTS question_type (
  type_key TEXT PRIMARY KEY,
  course_id TEXT REFERENCES course(course_id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  schema_json TEXT
);

CREATE TABLE IF NOT EXISTS tag (
  tag_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (course_id, name)
);

CREATE TABLE IF NOT EXISTS source (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER,
  institution TEXT,
  paper TEXT,
  original_page INTEGER,
  original_question_no TEXT,
  original_filename TEXT,
  import_job_id TEXT
);

CREATE TABLE IF NOT EXISTS question (
  question_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(course_id),
  type_key TEXT NOT NULL REFERENCES question_type(type_key),
  difficulty INTEGER,
  marks REAL,
  parent_question_id TEXT REFERENCES question(question_id) ON DELETE CASCADE,
  part_label TEXT,
  source_id TEXT REFERENCES source(source_id),
  notes TEXT,
  review_status TEXT NOT NULL DEFAULT 'approved',
  classification_confidence TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_question_course ON question(course_id);
CREATE INDEX IF NOT EXISTS idx_question_type ON question(type_key);
CREATE INDEX IF NOT EXISTS idx_question_difficulty ON question(difficulty);
CREATE INDEX IF NOT EXISTS idx_question_parent ON question(parent_question_id);

CREATE TABLE IF NOT EXISTS content_block (
  block_id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES question(question_id) ON DELETE CASCADE,
  slot TEXT NOT NULL DEFAULT 'body',
  position INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  content_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_block_question ON content_block(question_id, slot, position);

CREATE TABLE IF NOT EXISTS question_classification (
  question_id TEXT NOT NULL REFERENCES question(question_id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES course_node(node_id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_qc_node ON question_classification(node_id);

CREATE TABLE IF NOT EXISTS question_tag (
  question_id TEXT NOT NULL REFERENCES question(question_id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tag(tag_id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);

CREATE TABLE IF NOT EXISTS mcq_option (
  option_id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES question(question_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS asset (
  asset_id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES question(question_id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt_text TEXT,
  caption TEXT,
  original_filename TEXT
);

CREATE TABLE IF NOT EXISTS practice_session (
  session_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(course_id),
  filter_json TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_attempt (
  attempt_id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES practice_session(session_id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES question(question_id),
  status TEXT NOT NULL,
  correct INTEGER,
  time_spent_sec INTEGER,
  user_notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempt_question ON practice_attempt(question_id, created_at);

CREATE TABLE IF NOT EXISTS import_job (
  import_job_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(course_id),
  source_filename TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_question (
  import_question_id TEXT PRIMARY KEY,
  import_job_id TEXT NOT NULL REFERENCES import_job(import_job_id) ON DELETE CASCADE,
  proposed_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT 'pending',
  final_question_id TEXT REFERENCES question(question_id)
);

CREATE TABLE IF NOT EXISTS generated_test (
  test_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(course_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  target_marks REAL NOT NULL,
  achieved_marks REAL NOT NULL,
  question_count INTEGER NOT NULL,
  filter_json TEXT NOT NULL,
  question_ids_json TEXT NOT NULL,
  test_file_path TEXT NOT NULL,
  solutions_file_path TEXT NOT NULL,
  preview_file_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generated_test_course ON generated_test(course_id, created_at);
`;

export const BUILTIN_QUESTION_TYPES: Array<[string, string]> = [
  ["multiple_choice", "Multiple Choice"],
  ["short_answer", "Short Answer"],
  ["extended_response", "Extended Response"],
];