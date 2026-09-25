import { all, getFirst, run, runMany } from "./db/sqlite";
import { newId, nowUtc } from "./id";
import { deleteAssetBlob, finalizeQuestionAssets } from "./assets";
import { buildTestOutputs, deleteTestOutputs, ensureTestFileUrl, storeTestFiles } from "./tests";
import type {
  Course,
  CourseFullConfig,
  CourseNode,
  DifficultyLevel,
  GeneratedTestMeta,
  ImportResponse,
  LevelDef,
  NodeCount,
  Question,
  QuestionCountsResponse,
  QuestionListItem,
  QuestionListResponse,
  RandomQuestionResponse,
  Source,
  TestSectionInput,
  TestSectionResult,
} from "../api/types";

// ---------- helpers ----------

function parseJson(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return {};
  }
}

type SqlRow = Record<string, any>;

function boolFrom(row: SqlRow, field: string): boolean {
  const v = row[field];
  return v === 1 || v === "1" || v === true;
}

function titleCaseKey(key: string): string {
  return key
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ---------- courses ----------

export async function listCourses(): Promise<Course[]> {
  return getCourseRows();
}

async function getCourseRows(): Promise<Course[]> {
  const rows = await all<SqlRow>(
    `SELECT course_id, name, description, subject, curriculum, version_year,
            schema_version, allow_multi_classification, created_at, updated_at
     FROM course ORDER BY name`
  );
  return rows.map((r) => ({
    course_id: r.course_id,
    name: r.name,
    description: r.description,
    subject: r.subject,
    curriculum: r.curriculum,
    version_year: r.version_year,
    schema_version: r.schema_version,
    allow_multi_classification: boolFrom(r, "allow_multi_classification"),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function getCourseRow(courseId: string): Promise<Course | null> {
  const rows = await all<SqlRow>(
    `SELECT course_id, name, description, subject, curriculum, version_year,
            schema_version, allow_multi_classification, created_at, updated_at
     FROM course WHERE course_id = ?`,
    [courseId]
  );
  return rows.length ? rows[0] as unknown as Course : null;
}

async function courseRow(courseId: string): Promise<SqlRow | null> {
  return getFirst<SqlRow>("SELECT * FROM course WHERE course_id = ?", [courseId]);
}

export async function getCourseFullConfig(courseId: string): Promise<CourseFullConfig | null> {
  const course = await courseRow(courseId);
  if (!course) return null;
  const [nodesRaw, typesRaw, tagsRaw, levelsRaw, diffsRaw] = await Promise.all([
    all<SqlRow>("SELECT * FROM course_node WHERE course_id = ?", [courseId]),
    all<SqlRow>(
      "SELECT type_key FROM question_type WHERE course_id = ? OR course_id IS NULL ORDER BY type_key",
      [courseId]
    ),
    all<SqlRow>("SELECT name FROM tag WHERE course_id = ? ORDER BY name", [courseId]),
    all<SqlRow>(
      "SELECT level_index, label, required FROM course_level_def WHERE course_id = ? ORDER BY level_index",
      [courseId]
    ),
    all<SqlRow>(
      "SELECT level, label FROM difficulty_level WHERE course_id = ? ORDER BY level",
      [courseId]
    ),
  ]);
  return {
    course_id: course.course_id,
    name: course.name,
    schema_version: course.schema_version,
    hierarchy: levelsRaw.map((l) => ({
      level_index: l.level_index,
      label: l.label,
      required: boolFrom(l, "required"),
    })),
    allow_multi_classification: boolFrom(course, "allow_multi_classification"),
    difficulty_levels: diffsRaw.map((d) => ({ level: d.level, label: d.label })),
    question_types: typesRaw.map((t) => t.type_key),
    tags: tagsRaw.map((t) => t.name),
    nodes: buildNodeTree(nodesRaw),
  };
}

export function buildNodeTree(raw: Array<SqlRow>): CourseNode[] {
  const byId = new Map<string, SqlRow>();
  for (const n of raw) byId.set(n.node_id, n);
  const children0 = new Map<string, SqlRow[]>();
  for (const n of raw) {
    const key = n.parent_node_id ?? "";
    if (!children0.has(key)) children0.set(key, []);
    children0.get(key)!.push(n);
  }
  for (const list of children0.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }
  const build = (id: string): CourseNode => {
    const n = byId.get(id)!;
    return {
      node_id: n.node_id,
      course_id: n.course_id,
      parent_node_id: n.parent_node_id,
      level_index: n.level_index,
      name: n.name,
      code: n.code,
      description: n.description,
      sort_order: n.sort_order,
      children: (children0.get(id) ?? []).map((c) => build(c.node_id)),
    };
  };
  return (children0.get("") ?? []).map((c) => build(c.node_id));
}

export async function createCourse(payload: {
  name: string;
  description?: string | null;
  subject?: string | null;
  curriculum?: string | null;
  version_year?: string | null;
  allow_multi_classification?: boolean;
  hierarchy?: LevelDef[];
  difficulty_levels?: DifficultyLevel[];
  question_types?: string[];
}): Promise<CourseFullConfig> {
  const courseId = newId("course");
  const now = nowUtc();
  await run(
    `INSERT INTO course (course_id, name, description, subject, curriculum, version_year,
        schema_version, allow_multi_classification, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      courseId,
      payload.name,
      payload.description ?? null,
      payload.subject ?? null,
      payload.curriculum ?? null,
      payload.version_year ?? null,
      payload.allow_multi_classification ?? true ? 1 : 0,
      now,
      now,
    ]
  );
  const hierarchy = payload.hierarchy ?? [];
  for (const level of hierarchy) {
    await run(
      "INSERT INTO course_level_def (course_id, level_index, label, required) VALUES (?, ?, ?, ?)",
      [courseId, level.level_index, level.label, level.required ? 1 : 0]
    );
  }
  const difficultyLevels = payload.difficulty_levels ?? [
    { level: 1, label: "Very Easy" },
    { level: 2, label: "Easy" },
    { level: 3, label: "Difficult" },
    { level: 4, label: "Very Difficult" },
  ];
  for (const d of difficultyLevels) {
    await run(
      "INSERT INTO difficulty_level (course_id, level, label) VALUES (?, ?, ?)",
      [courseId, d.level, d.label]
    );
  }
  const questionTypes =
    payload.question_types ?? ["multiple_choice", "short_answer", "extended_response"];
  const existing = await all<SqlRow>("SELECT type_key FROM question_type");
  const have = new Set(existing.map((r) => r.type_key));
  for (const key of questionTypes) {
    if (!have.has(key)) {
      await run(
        "INSERT INTO question_type (type_key, display_name) VALUES (?, ?)",
        [key, titleCaseKey(key)]
      );
      have.add(key);
    }
  }
  const config = await getCourseFullConfig(courseId);
  if (!config) throw new Error("Course not found");
  return config;
}

// ---------- levels ----------

export async function addLevel(courseId: string, level: LevelDef): Promise<LevelDef> {
  const existing = await getFirst<SqlRow>(
    "SELECT level_index FROM course_level_def WHERE course_id = ? AND level_index = ?",
    [courseId, level.level_index]
  );
  if (existing) throw new Error(`Level index ${level.level_index} already exists`);
  await run(
    "INSERT INTO course_level_def (course_id, level_index, label, required) VALUES (?, ?, ?, ?)",
    [courseId, level.level_index, level.label, level.required ? 1 : 0]
  );
  return { level_index: level.level_index, label: level.label, required: level.required };
}

export async function updateLevel(
  courseId: string,
  levelIndex: number,
  level: LevelDef
): Promise<LevelDef> {
  const existing = await getFirst<SqlRow>(
    "SELECT level_index FROM course_level_def WHERE course_id = ? AND level_index = ?",
    [courseId, levelIndex]
  );
  if (!existing) throw new Error("Level not found");
  await run(
    "UPDATE course_level_def SET label = ?, required = ? WHERE course_id = ? AND level_index = ?",
    [level.label, level.required ? 1 : 0, courseId, levelIndex]
  );
  return { level_index: levelIndex, label: level.label, required: level.required };
}

export async function deleteLevel(courseId: string, levelIndex: number): Promise<void> {
  const existing = await getFirst<SqlRow>(
    "SELECT level_index FROM course_level_def WHERE course_id = ? AND level_index = ?",
    [courseId, levelIndex]
  );
  if (!existing) throw new Error("Level not found");
  const inUse = await getFirst<SqlRow>(
    "SELECT node_id FROM course_node WHERE course_id = ? AND level_index = ? LIMIT 1",
    [courseId, levelIndex]
  );
  if (inUse) {
    throw new Error(
      "Cannot delete a level that still has categories. Reassign or delete them first."
    );
  }
  await run("DELETE FROM course_level_def WHERE course_id = ? AND level_index = ?", [
    courseId,
    levelIndex,
  ]);
}

// ---------- nodes ----------

export async function createNode(
  courseId: string,
  payload: { level_index: number; parent_node_id?: string | null; name: string; code?: string | null }
): Promise<CourseNode> {
  const nodeId = newId("node");
  const now = nowUtc();
  await run(
    `INSERT INTO course_node (node_id, course_id, parent_node_id, level_index, name, code, description, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
    [
      nodeId,
      courseId,
      payload.parent_node_id ?? null,
      payload.level_index,
      payload.name,
      payload.code ?? null,
      now,
      now,
    ]
  );
  return {
    node_id: nodeId,
    course_id: courseId,
    parent_node_id: payload.parent_node_id ?? null,
    level_index: payload.level_index,
    name: payload.name,
    code: payload.code ?? null,
    description: null,
    sort_order: 0,
    children: [],
  };
}

export async function updateNode(
  courseId: string,
  nodeId: string,
  payload: Partial<{
    name: string;
    code: string | null;
    description: string | null;
    sort_order: number;
    parent_node_id: string | null;
  }>
): Promise<CourseNode> {
  const existing = await getFirst<SqlRow>(
    "SELECT * FROM course_node WHERE node_id = ? AND course_id = ?",
    [nodeId, courseId]
  );
  if (!existing) throw new Error("Node not found");
  const sets: string[] = [];
  const params: any[] = [];
  const keys: Array<keyof typeof payload> = [
    "name",
    "code",
    "description",
    "sort_order",
    "parent_node_id",
  ];
  for (const k of keys) {
    if (k in payload) {
      sets.push(`${k} = ?`);
      params.push((payload as any)[k] ?? null);
    }
  }
  sets.push("updated_at = ?");
  params.push(nowUtc());
  params.push(nodeId, courseId);
  await run(`UPDATE course_node SET ${sets.join(", ")} WHERE node_id = ? AND course_id = ?`, params);
  return {
    node_id: nodeId,
    course_id: courseId,
    parent_node_id: (payload.parent_node_id ?? null) as string | null,
    level_index: payload.parent_node_id === undefined ? existing.level_index : existing.level_index,
    name: (payload.name ?? existing.name) as string,
    code: (payload.code ?? existing.code) as string | null,
    description: (payload.description ?? existing.description) as string | null,
    sort_order: (payload.sort_order ?? existing.sort_order) as number,
    children: [],
  };
}

export async function deleteNode(courseId: string, nodeId: string): Promise<void> {
  const existing = await getFirst<SqlRow>(
    "SELECT node_id FROM course_node WHERE node_id = ? AND course_id = ?",
    [nodeId, courseId]
  );
  if (!existing) throw new Error("Node not found");
  await run("DELETE FROM course_node WHERE node_id = ?", [nodeId]);
}

// ---------- question filtering ----------

interface FilterOptions {
  courseId: string;
  approvedOnly?: boolean;
  wholeQuestions?: boolean;
  typeKey?: string | string[];
  typeKeys?: string[];
  difficulty?: number | string;
  difficulties?: Array<number | string>;
  difficultyMin?: number | string;
  difficultyMax?: number | string;
  marksMin?: number;
  marksMax?: number;
  nodeIds?: string[];
  tag?: string;
  q?: string;
}

function buildFilters(opts: FilterOptions): { where: string[]; params: any[] } {
  const where: string[] = ["q.course_id = ?"];
  const params: any[] = [opts.courseId];
  if (opts.approvedOnly) {
    where.push("q.review_status = 'approved'");
  }
  if (opts.wholeQuestions) {
    where.push("q.parent_question_id IS NULL");
  }
  if (opts.typeKey !== undefined && opts.typeKey !== null && opts.typeKey !== "") {
    const keys = Array.isArray(opts.typeKey) ? opts.typeKey : [opts.typeKey];
    where.push(`q.type_key IN (${keys.map(() => "?").join(", ")})`);
    params.push(...keys);
  }
  if (opts.typeKeys && opts.typeKeys.length) {
    where.push(`q.type_key IN (${opts.typeKeys.map(() => "?").join(", ")})`);
    params.push(...opts.typeKeys);
  }
  if (opts.difficulty !== undefined && opts.difficulty !== null && opts.difficulty !== "") {
    where.push("q.difficulty = ?");
    params.push(Number(opts.difficulty));
  }
  if (opts.difficulties && opts.difficulties.length) {
    where.push(`q.difficulty IN (${opts.difficulties.map(() => "?").join(", ")})`);
    params.push(...opts.difficulties.map((d) => Number(d)));
  }
  if (opts.difficultyMin !== undefined && opts.difficultyMin !== null && opts.difficultyMin !== "") {
    where.push("q.difficulty >= ?");
    params.push(Number(opts.difficultyMin));
  }
  if (opts.difficultyMax !== undefined && opts.difficultyMax !== null && opts.difficultyMax !== "") {
    where.push("q.difficulty <= ?");
    params.push(Number(opts.difficultyMax));
  }
  if (opts.marksMin !== undefined && opts.marksMin !== null) {
    where.push("q.marks >= ?");
    params.push(opts.marksMin);
  }
  if (opts.marksMax !== undefined && opts.marksMax !== null) {
    where.push("q.marks <= ?");
    params.push(opts.marksMax);
  }
  if (opts.nodeIds && opts.nodeIds.length) {
    where.push(
      `q.question_id IN (SELECT question_id FROM question_classification WHERE node_id IN (${opts.nodeIds
        .map(() => "?")
        .join(", ")}))`
    );
    params.push(...opts.nodeIds);
  }
  if (opts.tag) {
    where.push(
      `q.question_id IN (
        SELECT qt.question_id FROM question_tag qt JOIN tag tg ON tg.tag_id = qt.tag_id
        WHERE tg.course_id = ? AND tg.name = ?
      )`
    );
    params.push(opts.courseId, opts.tag);
  }
  if (opts.q) {
    where.push(
      `q.question_id IN (
        SELECT question_id FROM content_block WHERE slot = 'body' AND content_json LIKE ?
      )`
    );
    params.push(`%${opts.q}%`);
  }
  return { where, params };
}

async function snippetMap(questionIds: string[], length: number): Promise<Map<string, string>> {
  if (!questionIds.length) return new Map();
  const rows = await all<SqlRow>(
    `SELECT question_id, slot, position, block_type, content_json FROM content_block
     WHERE question_id IN (${questionIds.map(() => "?").join(", ")}) AND slot = 'body'
     ORDER BY question_id, position`,
    questionIds
  );
  const firstBy = new Map<string, SqlRow>();
  for (const r of rows) {
    if (!firstBy.has(r.question_id)) firstBy.set(r.question_id, r);
  }
  const out = new Map<string, string>();
  for (const [id, row] of firstBy) {
    const content = parseJson(row.content_json);
    const text = typeof content.text === "string"
      ? content.text
      : typeof content.latex === "string" && row.block_type === "equation"
        ? `$${content.latex}$`
        : content.latex;
    if (typeof text === "string" && text.trim()) {
      const s = text.trim();
      let preview = s;
      if (s.length > length) {
        preview = s.slice(0, length);
        const dollarCount = (preview.match(/\$/g) ?? []).length;
        if (dollarCount % 2 === 1) preview = preview.slice(0, preview.lastIndexOf("$"));
        out.set(id, preview + "…");
      } else {
        out.set(id, preview);
      }
    } else {
      out.set(id, "");
    }
  }
  return out;
}

// ---------- question serialization ----------

const BLOCK_SQL =
  "SELECT block_id, slot, position, block_type, content_json FROM content_block WHERE question_id = ? ORDER BY position";

function blockOut(b: SqlRow): Question["body"][number] {
  return {
    block_id: b.block_id,
    slot: b.slot,
    position: b.position,
    block_type: b.block_type,
    content: parseJson(b.content_json),
  };
}

export async function questionToOut(q: SqlRow, includeParts: boolean): Promise<Question> {
  const [blocks, nodeRows, tagRows, assets, source] = await Promise.all([
    all<SqlRow>(BLOCK_SQL, [q.question_id]),
    all<SqlRow>("SELECT node_id FROM question_classification WHERE question_id = ?", [
      q.question_id,
    ]),
    all<SqlRow>(
      `SELECT t.name FROM tag t JOIN question_tag qt ON qt.tag_id = t.tag_id
       WHERE qt.question_id = ? ORDER BY t.name`,
      [q.question_id]
    ),
    all<SqlRow>(
      "SELECT asset_id, file_path, mime_type, width, height, alt_text, caption FROM asset WHERE question_id = ?",
      [q.question_id]
    ),
    q.source_id
      ? getFirst<SqlRow>("SELECT * FROM source WHERE source_id = ?", [q.source_id])
      : Promise.resolve(null),
  ]);
  const sourceOut: Source | null =
    source && source.name
      ? {
          name: source.name,
          year: source.year ?? null,
          institution: source.institution ?? null,
          original_question_no: source.original_question_no ?? null,
        }
      : null;
  const slotOf = (slot: string) =>
    blocks.filter((b) => b.slot === slot).map((b) => blockOut(b));
  let parts: Question[] = [];
  if (includeParts) {
    const childRows = await all<SqlRow>(
      "SELECT * FROM question WHERE parent_question_id = ? ORDER BY created_at ASC, question_id",
      [q.question_id]
    );
    for (const child of childRows) {
      parts.push(await questionToOut(child, false));
    }
  }
  return {
    question_id: q.question_id,
    course_id: q.course_id,
    type_key: q.type_key,
    difficulty: q.difficulty ?? null,
    marks: q.marks ?? null,
    parent_question_id: q.parent_question_id ?? null,
    part_label: q.part_label ?? null,
    notes: q.notes ?? null,
    review_status: q.review_status,
    classification_confidence: q.classification_confidence ?? null,
    node_ids: nodeRows.map((r) => r.node_id),
    tags: tagRows.map((r) => r.name),
    body: slotOf("body"),
    answer: slotOf("answer"),
    solution: slotOf("solution"),
    marking_criteria: slotOf("marking_criteria"),
    assets: assets.map((a) => ({
      asset_id: a.asset_id,
      file_path: a.file_path,
      mime_type: a.mime_type,
      width: a.width ?? null,
      height: a.height ?? null,
      alt_text: a.alt_text ?? null,
      caption: a.caption ?? null,
    })),
    source: sourceOut,
    parts,
    created_at: q.created_at,
    updated_at: q.updated_at,
  };
}

async function hydrateQuestion(questionId: string): Promise<Question> {
  const q = await getFirst<SqlRow>("SELECT * FROM question WHERE question_id = ?", [questionId]);
  if (!q) throw new Error("Question not found");
  return questionToOut(q, true);
}

export function getQuestion(questionId: string): Promise<Question> {
  return hydrateQuestion(questionId);
}

export async function getCourseQuestions(courseId: string): Promise<Question[]> {
  const f = buildFilters({ courseId, approvedOnly: false, wholeQuestions: true });
  const rows = await all(
    `SELECT q.question_id FROM question q WHERE ${f.where.join(" AND ")} ORDER BY q.created_at ASC`,
    f.params
  );
  const out: Question[] = [];
  for (const r of rows) out.push(await hydrateQuestion(r.question_id));
  return out;
}

function sourceOutFrom(rows: SqlRow[]): Source | null {
  if (!rows.length) return null;
  const s = rows[0];
  return {
    name: s.name,
    year: s.year ?? null,
    institution: s.institution ?? null,
    original_question_no: s.original_question_no ?? null,
  };
}

// ---------- question CRUD ----------

type BlockPayload = { block_type: string; content: Record<string, any> };

export interface QuestionCreatePayload {
  course_id?: string;
  type_key: string;
  difficulty?: number | null;
  marks?: number | null;
  parent_question_id?: string | null;
  part_label?: string | null;
  notes?: string | null;
  node_ids?: string[];
  tag_names?: string[];
  body?: BlockPayload[];
  answer?: BlockPayload[];
  solution?: BlockPayload[];
  marking_criteria?: BlockPayload[];
  mcq_options?: Array<{ content: BlockPayload[]; is_correct?: boolean }>;
  source_name?: string;
  source_year?: number;
  source_institution?: string;
  source_original_question_no?: string;
  review_status?: string;
  classification_confidence?: string | null;
}

const SLOTS = ["body", "answer", "solution", "marking_criteria"] as const;

async function insertBlocks(
  questionId: string,
  slot: string,
  blocks: BlockPayload[] | undefined,
  statements: Array<[string, any[]]>,
  idPrefix = "blk"
): Promise<string[]> {
  const ids: string[] = [];
  (blocks ?? []).forEach((b, i) => {
    const blockId = newId(idPrefix);
    ids.push(blockId);
    statements.push([
      "INSERT INTO content_block (block_id, question_id, slot, position, block_type, content_json) VALUES (?, ?, ?, ?, ?, ?)",
      [blockId, questionId, slot, i, b.block_type, JSON.stringify(b.content ?? {})],
    ]);
  });
  return ids;
}

async function getOrCreateTag(courseId: string, name: string): Promise<string> {
  const row = await getFirst<SqlRow>("SELECT tag_id FROM tag WHERE course_id = ? AND name = ?", [
    courseId,
    name,
  ]);
  if (row) return row.tag_id;
  const tagId = newId("tag");
  await run("INSERT INTO tag (tag_id, course_id, name) VALUES (?, ?, ?)", [
    tagId,
    courseId,
    name,
  ]);
  return tagId;
}

interface SlotBlockSummary {
  slot: string;
  position: number;
  block_type: string;
  content_json: string;
}

async function finalizeAssetsForStatements(
  questionId: string,
  statements: Array<[string, any[]]>
): Promise<void> {
  const summaries: SlotBlockSummary[] = [];
  for (const [sql, params] of statements) {
    if (!sql.includes("INSERT INTO content_block")) continue;
    summaries.push({
      slot: String(params[2]),
      position: Number(params[3]),
      block_type: String(params[4]),
      content_json: String(params[5]),
    });
  }
  await finalizeQuestionAssets(questionId, summaries);
}

export async function createQuestion(payload: QuestionCreatePayload): Promise<Question> {
  if (!payload.course_id) throw new Error("Course not found");
  const course = await courseRow(payload.course_id);
  if (!course) throw new Error("Course not found");
  const type = await getFirst<SqlRow>(
    "SELECT type_key FROM question_type WHERE type_key = ?",
    [payload.type_key]
  );
  if (!type) throw new Error(`Unknown question type '${payload.type_key}'`);

  let sourceId: string | null = null;
  if (payload.source_name && payload.source_name.trim()) {
    sourceId = newId("src");
    await run(
      `INSERT INTO source (source_id, name, year, institution, original_question_no) VALUES (?, ?, ?, ?, ?)`,
      [
        sourceId,
        payload.source_name.trim(),
        payload.source_year ?? null,
        payload.source_institution ?? null,
        payload.source_original_question_no ?? null,
      ]
    );
  }

  const questionId = newId("q");
  const now = nowUtc();
  await run(
    `INSERT INTO question (question_id, course_id, type_key, difficulty, marks, parent_question_id,
        part_label, notes, review_status, classification_confidence, source_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      questionId,
      payload.course_id,
      payload.type_key,
      payload.difficulty ?? null,
      payload.marks ?? null,
      payload.parent_question_id ?? null,
      payload.part_label ?? null,
      payload.notes ?? null,
      payload.review_status ?? "approved",
      payload.classification_confidence ?? null,
      sourceId,
      now,
      now,
    ]
  );

  const statements: Array<[string, any[]]> = [];
  (payload.node_ids ?? []).forEach((nodeId, i) => {
    statements.push([
      "INSERT INTO question_classification (question_id, node_id, is_primary) VALUES (?, ?, ?)",
      [questionId, nodeId, i === 0 ? 1 : 0],
    ]);
  });
  for (const tagName of payload.tag_names ?? []) {
    const tagId = await getOrCreateTag(payload.course_id!, tagName.trim());
    statements.push([
      "INSERT INTO question_tag (question_id, tag_id) VALUES (?, ?)",
      [questionId, tagId],
    ]);
  }
  const blockIds: string[] = [];
  for (const slot of SLOTS) {
    const ids = await insertBlocks(questionId, slot, (payload as any)[slot], statements);
    blockIds.push(...ids);
  }
  (payload.mcq_options ?? []).forEach((opt, i) => {
    statements.push([
      "INSERT INTO mcq_option (option_id, question_id, position, content_json, is_correct) VALUES (?, ?, ?, ?, ?)",
      [
        newId("opt"),
        questionId,
        i,
        JSON.stringify(opt.content ?? []),
        opt.is_correct ? 1 : 0,
      ],
    ]);
  });
  await runMany(statements);
  await finalizeAssetsForStatements(questionId, statements);
  return hydrateQuestion(questionId);
}

export async function updateQuestion(
  questionId: string,
  payload: Partial<QuestionCreatePayload>
): Promise<Question> {
  const existing = await getFirst<SqlRow>(
    "SELECT * FROM question WHERE question_id = ?",
    [questionId]
  );
  if (!existing) throw new Error("Question not found");

  const sets: string[] = [];
  const params: any[] = [];
  const scalarKeys = ["type_key", "difficulty", "marks", "notes", "review_status"] as const;
  for (const k of scalarKeys) {
    if (k in payload && (payload as any)[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push((payload as any)[k] ?? null);
    }
  }
  sets.push("updated_at = ?");
  params.push(nowUtc());
  params.push(questionId);
  if (sets.length) {
    await run(`UPDATE question SET ${sets.join(", ")} WHERE question_id = ?`, params);
  }

  if (payload.node_ids) {
    await run("DELETE FROM question_classification WHERE question_id = ?", [questionId]);
    const statements: Array<[string, any[]]> = [];
    payload.node_ids.forEach((nodeId, i) => {
      statements.push([
        "INSERT INTO question_classification (question_id, node_id, is_primary) VALUES (?, ?, ?)",
        [questionId, nodeId, i === 0 ? 1 : 0],
      ]);
    });
    for (const [s, p] of statements) await run(s, p);
  }
  if (payload.tag_names) {
    await run("DELETE FROM question_tag WHERE question_id = ?", [questionId]);
    for (const tagName of payload.tag_names) {
      const tagId = await getOrCreateTag(existing.course_id, tagName.trim());
      await run("INSERT INTO question_tag (question_id, tag_id) VALUES (?, ?)", [
        questionId,
        tagId,
      ]);
    }
  }
  const statements: Array<[string, any[]]> = [];
  for (const slot of SLOTS) {
    const value = (payload as any)[slot];
    if (value !== undefined && value !== null) {
      await run("DELETE FROM content_block WHERE question_id = ? AND slot = ?", [
        questionId,
        slot,
      ]);
      await insertBlocks(questionId, slot, value, statements);
    }
  }
  if (statements.length) {
    await runMany(statements);
    await finalizeAssetsForStatements(questionId, statements);
  }
  return hydrateQuestion(questionId);
}

async function deleteAssetBlobsFor(questionId: string): Promise<void> {
  const ids = await all<SqlRow>("SELECT asset_id FROM asset WHERE question_id = ?", [
    questionId,
  ]);
  for (const row of ids) await deleteAssetBlob(row.asset_id);
  const children = await all<SqlRow>(
    "SELECT question_id FROM question WHERE parent_question_id = ?",
    [questionId]
  );
  for (const child of children) await deleteAssetBlobsFor(child.question_id);
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const existing = await getFirst<SqlRow>(
    "SELECT question_id FROM question WHERE question_id = ?",
    [questionId]
  );
  if (!existing) throw new Error("Question not found");
  await run("DELETE FROM practice_attempt WHERE question_id = ?", [questionId]);
  await run("UPDATE import_question SET final_question_id = NULL WHERE final_question_id = ?", [
    questionId,
  ]);
  await deleteAssetBlobsFor(questionId);
  await run("DELETE FROM question WHERE question_id = ?", [questionId]);
}

// ---------- listing / counts / random ----------

const SORT_SQL: Record<string, string> = {
  created_desc: "q.created_at DESC",
  created_asc: "q.created_at ASC",
  difficulty_asc: "q.difficulty ASC",
  difficulty_desc: "q.difficulty DESC",
  random: "RANDOM()",
};

export async function listQuestions(
  courseId: string,
  filters: {
    node_id?: string | string[];
    type?: string | string[];
    difficulty?: string | number | Array<string | number>;
    tag?: string;
    q?: string;
    sort?: string;
    page?: number;
    page_size?: number;
  } = {}
): Promise<QuestionListResponse> {
  const difficulty = filters.difficulty;
  const f = buildFilters({
    courseId,
    approvedOnly: true,
    wholeQuestions: true,
    typeKey: filters.type,
    difficulties: Array.isArray(difficulty) ? difficulty : undefined,
    difficulty: Array.isArray(difficulty) ? undefined : (difficulty as string | number | undefined),
    nodeIds: filters.node_id ? (Array.isArray(filters.node_id) ? filters.node_id : [filters.node_id]) : undefined,
    tag: filters.tag,
    q: filters.q,
  });
  const whereSql = f.where.join(" AND ");
  const totalRow = await getFirst<SqlRow>(
    `SELECT COUNT(*) AS c FROM question q WHERE ${whereSql}`,
    f.params
  );
  const total = totalRow ? Number(totalRow.c) : 0;
  const page = filters.page ?? 1;
  const pageSize = filters.page_size ?? 25;
  const sortSql = SORT_SQL[filters.sort ?? ""] ?? SORT_SQL.created_desc;
  const rows = await all<SqlRow>(
    `SELECT q.question_id, q.type_key, q.difficulty, q.marks,
            s.name, s.year, s.institution, s.original_question_no
     FROM question q LEFT JOIN source s ON s.source_id = q.source_id
     WHERE ${whereSql}
     ORDER BY ${sortSql}
     LIMIT ? OFFSET ?`,
    [...f.params, pageSize, (page - 1) * pageSize]
  );
  const snippets = await snippetMap(rows.map((r) => r.question_id), 160);
  const items: QuestionListItem[] = rows.map((r) => ({
    question_id: r.question_id,
    type_key: r.type_key,
    difficulty: r.difficulty ?? null,
    marks: r.marks ?? null,
    snippet: snippets.get(r.question_id) ?? "",
    source: sourceOutFrom([r]),
  }));
  return { total, page, page_size: pageSize, items };
}

export async function questionCounts(
  courseId: string,
  opts: { type?: string | string[]; difficulty?: string | number } = {}
): Promise<QuestionCountsResponse> {
  const f = buildFilters({
    courseId,
    approvedOnly: true,
    wholeQuestions: true,
    typeKey: opts.type,
    difficulty: opts.difficulty,
  });
  const whereSql = f.where.join(" AND ");
  const totalRow = await getFirst<SqlRow>(
    `SELECT COUNT(*) AS c FROM question q WHERE ${whereSql}`,
    f.params
  );
  const total = totalRow ? Number(totalRow.c) : 0;

  const nodesRaw = await all<SqlRow>(
    "SELECT * FROM course_node WHERE course_id = ? ORDER BY sort_order",
    [courseId]
  );
  const nodeCounts = await all<SqlRow>(
    `SELECT node_id, COUNT(*) AS c FROM question_classification
     WHERE question_id IN (SELECT question_id FROM question q WHERE ${whereSql})
     GROUP BY node_id`,
    f.params
  );
  const countByNode = new Map<string, number>();
  for (const r of nodeCounts) countByNode.set(r.node_id, Number(r.c));
  const byId = new Map(nodesRaw.map((n) => [n.node_id, n]));
  const rollup = (id: string): NodeCount => {
    const n = byId.get(id)!;
    const own = countByNode.get(id) ?? 0;
    const children = nodesRaw
      .filter((c) => c.parent_node_id === id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => rollup(c.node_id));
    return {
      node_id: n.node_id,
      name: n.name,
      level_index: n.level_index,
      count: own + children.reduce((sum, c) => sum + c.count, 0),
      children,
    };
  };
  const byNode = nodesRaw
    .filter((n) => n.parent_node_id === null)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((n) => rollup(n.node_id));

  const byTypeRows = await all<SqlRow>(
    `SELECT type_key, COUNT(*) AS c FROM question q WHERE ${whereSql} GROUP BY type_key`,
    f.params
  );
  const byType: Record<string, number> = {};
  for (const r of byTypeRows) byType[r.type_key] = Number(r.c);

  const byDiffRows = await all<SqlRow>(
    `SELECT difficulty, COUNT(*) AS c FROM question q WHERE ${whereSql} GROUP BY difficulty`,
    f.params
  );
  const byDifficulty: Record<string, number> = {};
  for (const r of byDiffRows) byDifficulty[String(r.difficulty)] = Number(r.c);

  return { total, by_node: byNode, by_type: byType, by_difficulty: byDifficulty };
}

export async function randomQuestion(params: {
  course_id: string;
  node_id?: string | string[];
  type?: string | string[];
  difficulty?: string | number | Array<string | number>;
  tag?: string;
  exclude_question_ids?: Array<string | number>;
  exclude_recent_days?: number;
}): Promise<RandomQuestionResponse> {
  const difficulty = params.difficulty;
  const f = buildFilters({
    courseId: params.course_id,
    approvedOnly: true,
    wholeQuestions: true,
    typeKey: params.type,
    difficulties: Array.isArray(difficulty) ? difficulty : undefined,
    difficulty: Array.isArray(difficulty) ? undefined : (difficulty as string | number | undefined),
    nodeIds: params.node_id
      ? Array.isArray(params.node_id)
        ? params.node_id
        : [params.node_id]
      : undefined,
    tag: params.tag,
  });
  const where2 = [...f.where];
  const params2 = [...f.params];
  const excludes = (params.exclude_question_ids ?? []).map((x) => String(x));
  if (excludes.length) {
    where2.push(`q.question_id NOT IN (${excludes.map(() => "?").join(", ")})`);
    params2.push(...excludes);
  }
  if (params.exclude_recent_days) {
    where2.push(
      `q.question_id NOT IN (
        SELECT question_id FROM practice_attempt
        WHERE created_at >= datetime('now', ?)
      )`
    );
    params2.push(`-${params.exclude_recent_days} days`);
  }
  const cond = where2.join(" AND ");
  const countRow = await getFirst<SqlRow>(
    `SELECT COUNT(*) AS c FROM question q WHERE ${cond}`,
    params2
  );
  const matchingCount = countRow ? Number(countRow.c) : 0;
  if (!matchingCount) return { matching_count: 0, question: null };
  const row = await getFirst<SqlRow>(
    `SELECT q.question_id FROM question q WHERE ${cond} ORDER BY RANDOM() LIMIT 1`,
    params2
  );
  if (!row) return { matching_count: 0, question: null };
  const question = await hydrateQuestion(row.question_id);
  return { matching_count: matchingCount, question };
}

// ---------- practice ----------

export async function createSession(
  courseId: string,
  filter: Record<string, any> | null,
  mode: string = "random"
): Promise<{ session_id: string; course_id: string; mode: string }> {
  const course = await courseRow(courseId);
  if (!course) throw new Error("Course not found");
  const sessionId = newId("sess");
  const now = nowUtc();
  await run(
    "INSERT INTO practice_session (session_id, course_id, filter_json, mode, created_at) VALUES (?, ?, ?, ?, ?)",
    [sessionId, courseId, JSON.stringify(filter ?? {}), mode, now]
  );
  return { session_id: sessionId, course_id: courseId, mode };
}

export async function recordAttempt(payload: {
  session_id?: string;
  question_id: string;
  status: string;
  correct?: boolean;
  time_spent_sec?: number;
  user_notes?: string;
}): Promise<{ attempt_id: string }> {
  const q = await getFirst<SqlRow>("SELECT question_id FROM question WHERE question_id = ?", [
    payload.question_id,
  ]);
  if (!q) throw new Error("Question not found");
  const attemptId = newId("att");
  await run(
    `INSERT INTO practice_attempt (attempt_id, session_id, question_id, status, correct, time_spent_sec, user_notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attemptId,
      payload.session_id ?? null,
      payload.question_id,
      payload.status,
      payload.correct === undefined || payload.correct === null ? null : payload.correct ? 1 : 0,
      payload.time_spent_sec ?? null,
      payload.user_notes ?? null,
      nowUtc(),
    ]
  );
  return { attempt_id: attemptId };
}

export async function recentQuestions(
  courseId: string,
  limit: number = 10
): Promise<Array<{ question_id: string; course_id: string; snippet: string; type_key: string; status: string; seen_at: string }>> {
  const rows = await all<SqlRow>(
    `SELECT a.question_id, q.type_key, q.course_id, MAX(a.created_at) AS last_seen,
            (SELECT a2.status FROM practice_attempt a2
             WHERE a2.question_id = a.question_id ORDER BY a2.created_at DESC LIMIT 1) AS latest_status
     FROM practice_attempt a JOIN question q ON q.question_id = a.question_id
     WHERE q.course_id = ?
     GROUP BY a.question_id
     ORDER BY last_seen DESC
     LIMIT ?`,
    [courseId, limit]
  );
  const snippets = await snippetMap(rows.map((r) => r.question_id), 90);
  return rows.map((r) => ({
    question_id: r.question_id,
    course_id: r.course_id,
    snippet: snippets.get(r.question_id) ?? "",
    type_key: r.type_key,
    status: r.latest_status ?? "seen",
    seen_at: r.last_seen,
  }));
}

// ---------- instructions / skill ----------

export async function getInstructions(courseId: string): Promise<{ course_id: string; instructions_markdown: string }> {
  const config = await getCourseFullConfig(courseId);
  if (!config) throw new Error("Course not found");
  return { course_id: courseId, instructions_markdown: buildInstructionsMarkdown(config) };
}

export function buildInstructionsMarkdown(config: CourseFullConfig): string {
  const lines: string[] = [];
  lines.push(`# COURSE: ${config.name}`);
  lines.push(`schema_version: ${config.schema_version}`);
  lines.push("");
  lines.push("## STRUCTURE");
  for (const level of config.hierarchy) {
    lines.push(`Level ${level.level_index + 1}: ${level.label}${level.required ? "" : " (optional)"}`);
  }
  lines.push("");
  lines.push("## VALID NODES");
  const walk = (nodes: CourseNode[], depth: number): string[] => {
    const out: string[] = [];
    for (const n of nodes) {
      out.push(`${"  ".repeat(depth)}${n.code ? `${n.code} — ` : ""}${n.name}`);
      out.push(...walk(n.children, depth + 1));
    }
    return out;
  };
  lines.push(...walk(config.nodes, 0));
  lines.push("");
  lines.push("## QUESTION TYPES");
  lines.push(config.question_types.join(", "));
  lines.push("");
  lines.push("## DIFFICULTY");
  lines.push(config.difficulty_levels.map((d) => `"${d.level} = ${d.label}"`).join(", "));
  lines.push("");
  lines.push("## CLASSIFICATION RULES");
  lines.push(
    config.allow_multi_classification
      ? "- A question MAY be classified under more than one node."
      : "- A question MUST be classified under exactly one node."
  );
  lines.push("- A question may span more than one node only when the answer genuinely uses both.");
  lines.push("- Never mark a classification as low or medium confidence if you are sure of it.");
  lines.push(
    "- If you are unsure but the question is otherwise complete, still import it but set classification_confidence to low."
  );
  lines.push("");
  lines.push("## OUTPUT FORMAT");
  lines.push("The output must be JSON matching schema_version 1 and the import format.");
  lines.push("Multi-part questions: the parent carries the shared stem and `parts` each carry one marked subsection.");
  return lines.join("\n");
}

// ---------- import ----------

export async function importJson(courseId: string, data: any): Promise<ImportResponse> {
  const course = await courseRow(courseId);
  if (!course) throw new Error("Course not found");
  const jobWarnings: string[] = [];
  if (data && data.course_id !== null && data.course_id !== undefined && String(data.course_id) !== String(courseId)) {
    const fileCourseName = data.course_name ? String(data.course_name).trim() : "";
    const nameMatches = fileCourseName !== "" && fileCourseName.toLowerCase() === course.name.trim().toLowerCase();
    if (nameMatches) {
      jobWarnings.push(
        `This file was generated for course id '${data.course_id}', but you're importing into '${course.name}' (id '${courseId}'). ` +
          `Course and node ids are regenerated when a course is re-imported, so the file was matched by course name and node codes instead.`
      );
    } else if (fileCourseName) {
      throw new Error(
        `This file is for course '${fileCourseName}' (id '${data.course_id}'), not '${course.name}' (id '${courseId}').`
      );
    } else {
      throw new Error(
        `This file was generated for course id '${data.course_id}', not '${courseId}'. If you re-imported this course and its ids were regenerated, add "course_name" to the file (see the course skill) so it can be matched by name.`
      );
    }
  }
  const config = await getCourseFullConfig(courseId);
  if (!config) throw new Error("Course not found");
  const validTypeKeys = new Set(config.question_types);
  const validDifficulties = config.difficulty_levels.map((d) => d.level);
  const validNodeIds = new Set<string>();
  const codeToNodeId = new Map<string, string>();
  const pathToNodeId = new Map<string, string>();
  const nameToNodeIds = new Map<string, string[]>();
  const collect = (nodes: CourseNode[], parentPath: string) => {
    for (const n of nodes) {
      validNodeIds.add(n.node_id);
      if (n.code) codeToNodeId.set(String(n.code), n.node_id);
      const fullPath = parentPath ? `${parentPath} / ${n.name}` : n.name;
      pathToNodeId.set(fullPath, n.node_id);
      const list = nameToNodeIds.get(n.name) ?? [];
      list.push(n.node_id);
      nameToNodeIds.set(n.name, list);
      collect(n.children, fullPath);
    }
  };
  collect(config.nodes, "");

  const jobId = newId("imp");
  const now = nowUtc();
  await run(
    "INSERT INTO import_job (import_job_id, course_id, source_filename, status, created_at) VALUES (?, ?, ?, 'processing', ?)",
    [jobId, courseId, data?.source_filename ?? null, now]
  );

  const questions: any[] = data?.questions ?? [];
  const results: ImportResponse["results"] = [];
  let importedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!validTypeKeys.has(q.type_key)) {
      errors.push(
        `Unknown question type '${q.type_key}'. Valid types: ${[...validTypeKeys].sort().join(", ")}`
      );
    }
    if (validDifficulties.length && !validDifficulties.includes(q.difficulty)) {
      errors.push(
        `Invalid difficulty level ${q.difficulty}. Valid: ${[...validDifficulties].sort().join(", ")}`
      );
    }
    const byCode = Array.isArray(q.node_codes) && q.node_codes.length > 0;
    const byName = Array.isArray(q.node_names) && q.node_names.length > 0;
    let nodeRefs: string[] = [];
    if (byCode) nodeRefs = q.node_codes.map(String);
    else if (byName) nodeRefs = q.node_names.map(String);
    else nodeRefs = (q.node_ids ?? []).map(String);
    const resolvedNodes: Array<{ node_id: string; ref: string; remapped: boolean }> = [];
    const unknownNodes: string[] = [];
    const seenNodes = new Set<string>();
    for (const ref of nodeRefs) {
      let target: string | null = null;
      let remapped = false;
      if (validNodeIds.has(ref)) {
        target = ref;
      } else if (codeToNodeId.has(ref)) {
        target = codeToNodeId.get(ref)!;
        remapped = true;
      } else if (pathToNodeId.has(ref)) {
        target = pathToNodeId.get(ref)!;
        remapped = true;
      } else {
        const cands = nameToNodeIds.get(ref);
        if (cands && cands.length === 1) {
          target = cands[0];
          remapped = true;
        } else if (cands && cands.length > 1) {
          unknownNodes.push(`${ref} (matches ${cands.length} nodes — use a full path)`);
          continue;
        }
      }
      if (!target) {
        unknownNodes.push(ref);
      } else if (!seenNodes.has(target)) {
        seenNodes.add(target);
        resolvedNodes.push({ node_id: target, ref, remapped });
      }
    }
    if (unknownNodes.length) {
      errors.push(
        `Unknown node${unknownNodes.length > 1 ? "s" : ""}: ${unknownNodes.join(", ")}. Every node must be a valid node_id, node code, node name or full node path from the course's import-schema.json.`
      );
    }
    const remapped = resolvedNodes.filter((n) => n.remapped);
    if (remapped.length) {
      warnings.push(
        `Classified ${
          remapped.length > 1 ? "using stable references" : "by stable reference"
        } (${remapped.map((n) => n.ref).join(", ")}) — node ids were regenerated when this course was re-imported.`
      );
    }
    const hasBody = Array.isArray(q.body) && q.body.length > 0;
    if (!hasBody) errors.push("Question has no body content blocks");
    const hasMc = Array.isArray(q.marking_criteria) && q.marking_criteria.length > 0;
    const hasAnswer = Array.isArray(q.answer) && q.answer.length > 0;
    const hasSolution = Array.isArray(q.solution) && q.solution.length > 0;
    if (!hasMc && !hasAnswer && !hasSolution) {
      warnings.push("No marking guide, answer, or solution provided for this question");
    } else if (!hasMc) {
      warnings.push("No marking guide (marking_criteria) provided — only answer/solution");
    }
    const confidence = q.classification_confidence ?? "medium";
    await run(
      `INSERT INTO import_question (import_question_id, import_job_id, proposed_json, confidence, resolution, final_question_id)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      [newId("iq"), jobId, JSON.stringify(q), confidence, errors.length ? "rejected" : "approved"]
    );
    if (errors.length) {
      errorCount++;
      results.push({ index: i, status: "error", errors, warnings });
      continue;
    }
    let sourceId: string | null = null;
    if (q.source && q.source.name) {
      sourceId = newId("src");
      await run(
        "INSERT INTO source (source_id, name, year, institution, original_question_no) VALUES (?, ?, ?, ?, ?)",
        [sourceId, q.source.name, q.source.year ?? null, q.source.institution ?? null, q.source.original_question_no ?? null]
      );
    }
    const parentId = newId("q");
    await run(
      `INSERT INTO question (question_id, course_id, type_key, difficulty, marks, review_status, classification_confidence, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
      [parentId, courseId, q.type_key, q.difficulty ?? null, q.marks ?? null, confidence, sourceId, now, now]
    );
    const statements: Array<[string, any[]]> = [];
    resolvedNodes.forEach((n, idx) => {
      statements.push([
        "INSERT INTO question_classification (question_id, node_id, is_primary) VALUES (?, ?, ?)",
        [parentId, n.node_id, idx === 0 ? 1 : 0],
      ]);
    });
    for (const tagName of q.tags ?? []) {
      const tagId = await getOrCreateTag(courseId, tagName);
      statements.push(["INSERT INTO question_tag (question_id, tag_id) VALUES (?, ?)", [parentId, tagId]]);
    }
    for (const slot of SLOTS) {
      if (Array.isArray(q[slot])) {
        await insertBlocks(parentId, slot, q[slot], statements);
      }
    }
    await runMany(statements);
    await finalizeAssetsForStatements(parentId, statements);
    for (const part of q.parts ?? []) {
      const partId = newId("q");
      await run(
        `INSERT INTO question (question_id, course_id, type_key, marks, parent_question_id, part_label, review_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
        [partId, courseId, q.type_key, part.marks ?? null, parentId, part.part_label ?? null, now, now]
      );
      const partStatements: Array<[string, any[]]> = [];
      for (const slot of SLOTS) {
        if (Array.isArray(part[slot])) {
          await insertBlocks(partId, slot, part[slot], partStatements);
        }
      }
      await runMany(partStatements);
      await finalizeAssetsForStatements(partId, partStatements);
    }
    importedCount++;
    results.push({ index: i, status: "imported", question_id: parentId, errors, warnings });
  }

  await run("UPDATE import_job SET status = ? WHERE import_job_id = ?", [
    importedCount ? "imported" : "failed",
    jobId,
  ]);
  return { import_job_id: jobId, imported_count: importedCount, error_count: errorCount, results, warnings: jobWarnings };
}

// ---------- test generation ----------

export interface GenerateTestPayload {
  title?: string;
  node_ids?: string[];
  type_key?: string;
  difficulty_min?: number;
  difficulty_max?: number;
  target_marks?: number;
  format?: "docx" | "pdf";
  shuffle?: boolean;
  sections?: TestSectionInput[];
}

async function matchingQuestionIds(
  courseId: string,
  opts: {
    type_key?: string;
    type_keys?: string[];
    difficulties?: Array<number | string>;
    difficulty_min?: number;
    difficulty_max?: number;
    marks_min?: number;
    marks_max?: number;
    node_ids?: string[];
    limit?: number;
  }
): Promise<SqlRow[]> {
  const f = buildFilters({
    courseId,
    approvedOnly: true,
    wholeQuestions: true,
    typeKey: opts.type_key,
    typeKeys: opts.type_keys,
    difficulties: opts.difficulties,
    difficultyMin: opts.difficulty_min,
    difficultyMax: opts.difficulty_max,
    marksMin: opts.marks_min,
    marksMax: opts.marks_max,
    nodeIds: opts.node_ids,
  });
  const limitSql = opts.limit ? "LIMIT ?" : "";
  const params = opts.limit ? [...f.params, opts.limit] : f.params;
  return all<SqlRow>(
    `SELECT q.question_id FROM question q WHERE ${f.where.join(
      " AND "
    )} ORDER BY q.created_at ASC ${limitSql}`,
    params
  );
}

function shuffleList<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function selectForMarks(
  courseId: string,
  target: number,
  opts: Parameters<typeof matchingQuestionIds>[1]
): Promise<Question[]> {
  const rows = await matchingQuestionIds(courseId, opts);
  const picked: Question[] = [];
  let total = 0;
  const bound = target + 1e-9;
  for (const row of rows) {
    const q = await hydrateQuestion(row.question_id);
    if (q.marks == null) continue;
    if (total + q.marks <= bound) {
      total += q.marks;
      picked.push(q);
    }
  }
  if (total < target - 1e-9) {
    const remaining: Question[] = [];
    const pickedIds = new Set(picked.map((p) => p.question_id));
    for (const row of rows) {
      if (pickedIds.has(row.question_id)) continue;
      const q = await hydrateQuestion(row.question_id);
      if (q.marks != null) remaining.push(q);
    }
    remaining.sort((a, b) => (a.marks ?? 0) - (b.marks ?? 0));
    const tolerance = Math.max(1.0, target * 0.15);
    for (const q of remaining) {
      if (q.marks == null) continue;
      if ((total + q.marks) - target <= tolerance) {
        total += q.marks;
        picked.push(q);
      }
    }
  }
  return picked;
}

async function selectN(
  courseId: string,
  count: number,
  opts: Parameters<typeof matchingQuestionIds>[1]
): Promise<Question[]> {
  const rows = await matchingQuestionIds(courseId, { ...opts, limit: count });
  const out: Question[] = [];
  for (const row of rows) out.push(await hydrateQuestion(row.question_id));
  return out;
}

async function sectionQuestions(
  courseId: string,
  index: number,
  sec: TestSectionInput,
  config: CourseFullConfig
): Promise<{ questions: Question[]; marks: number }> {
  const hasCount = sec.count !== undefined && sec.count !== null;
  const hasMarks = sec.marks !== undefined && sec.marks !== null;
  if (hasCount === hasMarks) {
    throw new Error(`Section ${index}: set either a question count or a marks target.`);
  }
  const opts = {
    type_key: sec.type_key || undefined,
    type_keys: sec.type_key ? undefined : sec.type_keys,
    difficulties: sec.difficulties,
    node_ids: sec.node_ids,
  };
  const display = sec.name || `Section ${index + 1}`;
  let questions: Question[];
  let secMarks: number;
  if (hasCount) {
    questions = await selectN(courseId, sec.count!, opts);
    secMarks = round2(questions.reduce((sum, q) => sum + (q.marks ?? 0), 0));
  } else {
    questions = await selectForMarks(courseId, sec.marks!, opts);
    secMarks = round2(questions.reduce((sum, q) => sum + (q.marks ?? 0), 0));
  }
  if (!questions.length) {
    throw new Error(
      `No approved questions match ${display}. Try widening the topics/type filters, or set marks on matching questions.`
    );
  }
  const _ = config; // selection is course-scoped already
  void _;
  return { questions, marks: secMarks };
}

export async function generateTest(
  courseId: string,
  payload: GenerateTestPayload
): Promise<GeneratedTestMeta> {
  const config = await getCourseFullConfig(courseId);
  if (!config) throw new Error("Course not found");
  const sections = payload.sections ?? [];
  const single = sections.length <= 1;
  let work: Array<TestSectionInput & { label: string | null; display: string }>;
  if (!sections.length) {
    if (!payload.target_marks || payload.target_marks <= 0) {
      throw new Error("target_marks must be greater than 0");
    }
    work = [{ marks: payload.target_marks, label: null, display: "Section 1" }];
  } else {
    work = sections.map((sec, i) => ({
      ...sec,
      label: sec.name ?? (single ? null : `Section ${String.fromCharCode(65 + i)}`),
      display: sec.name ?? `Section ${i + 1}`,
    }));
  }

  const sectionResults: TestSectionResult[] = [];
  const allQuestions: Question[] = [];
  const sectionQuestionsByWork: Array<{ label: string | null; questions: Question[] }> = [];
  let targetMarks = 0;
  for (let i = 0; i < work.length; i++) {
    const sec = work[i];
    const { questions, marks } = await sectionQuestions(courseId, i, sec, config);
    const picked = payload.shuffle === false ? questions : shuffleList(questions);
    allQuestions.push(...picked);
    sectionQuestionsByWork.push({ label: sec.label, questions: picked });
    sectionResults.push({
      name: sec.label ?? sec.display,
      question_count: picked.length,
      marks,
      count_requested: sec.count ?? null,
      marks_requested: sec.marks ?? null,
    });
    if (sec.marks !== undefined && sec.marks !== null) targetMarks += sec.marks;
  }

  if (!allQuestions.length) {
    throw new Error("No questions were selected for this test.");
  }

  const title = payload.title?.trim() || `${config.name} — Practice Test`;
  const format = payload.format ?? "docx";
  const achieved = round2(allQuestions.reduce((sum, q) => sum + (q.marks ?? 0), 0));
  const testId = newId("test");

  const files = await buildTestOutputs({
    testId,
    title,
    courseName: config.name,
    format,
    questions: allQuestions,
    sectionResults,
    achievedMarks: achieved,
    sections: sectionQuestionsByWork,
  });
  await storeTestFiles(testId, files);
  const testUrl = (await ensureTestFileUrl(testId, "test")) ?? "";
  const solutionsUrl = (await ensureTestFileUrl(testId, "solutions")) ?? "";
  const previewUrl = (await ensureTestFileUrl(testId, "preview")) ?? "";
  const extension = format === "pdf" ? "pdf" : "docx";

  await run(
    `INSERT INTO generated_test (test_id, course_id, title, format, target_marks, achieved_marks,
        question_count, filter_json, question_ids_json, test_file_path, solutions_file_path, preview_file_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      testId,
      courseId,
      title,
      format,
      round2(targetMarks),
      achieved,
      allQuestions.length,
      JSON.stringify(payload),
      JSON.stringify(allQuestions.map((q) => q.question_id)),
      `${testId}-test.${extension}`,
      `${testId}-solutions.${extension}`,
      `${testId}-preview.pdf`,
      nowUtc(),
    ]
  );
  return {
    test_id: testId,
    title,
    format,
    target_marks: round2(targetMarks),
    achieved_marks: achieved,
    question_count: allQuestions.length,
    created_at: nowUtc(),
    test_download_url: testUrl,
    solutions_download_url: solutionsUrl,
    preview_url: previewUrl,
    section_results: sectionResults,
  };
}

export async function listTests(courseId: string, limit: number = 20): Promise<GeneratedTestMeta[]> {
  const rows = await all<SqlRow>(
    `SELECT * FROM generated_test WHERE course_id = ? ORDER BY created_at DESC LIMIT ?`,
    [courseId, limit]
  );
  const out: GeneratedTestMeta[] = [];
  for (const r of rows) {
    const testUrl = (await ensureTestFileUrl(r.test_id, "test")) ?? "";
    const solutionsUrl = (await ensureTestFileUrl(r.test_id, "solutions")) ?? "";
    const previewUrl = (await ensureTestFileUrl(r.test_id, "preview")) ?? "";
    out.push({
      test_id: r.test_id,
      title: r.title,
      format: r.format,
      target_marks: r.target_marks,
      achieved_marks: r.achieved_marks,
      question_count: r.question_count,
      created_at: r.created_at,
      test_download_url: testUrl,
      solutions_download_url: solutionsUrl,
      preview_url: previewUrl,
    });
  }
  return out;
}

export async function deleteTest(testId: string): Promise<void> {
  await deleteTestOutputs(testId);
  await run("DELETE FROM generated_test WHERE test_id = ?", [testId]);
}
