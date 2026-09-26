import JSZip from "jszip";
import * as idb from "./db/indexeddb";
import { all, getFirst, run } from "./db/sqlite";
import { newId, nowUtc } from "./id";
import * as data from "./data";
import type { CourseFullConfig, CourseNode, Question } from "../api/types";

// ---------- helpers ----------

export function slugName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || name;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flattenNodes(nodes: CourseNode[]): Array<{ node_id: string; name: string; code: string | null; level_index: number; path: string }> {
  const out: Array<{ node_id: string; name: string; code: string | null; level_index: number; path: string }> = [];
  const walk = (list: CourseNode[], path: string[]) => {
    for (const n of list) {
      const fullPath = [...path, n.name];
      out.push({
        node_id: n.node_id,
        name: n.name,
        code: n.code,
        level_index: n.level_index,
        path: fullPath.join(" > "),
      });
      walk(n.children, fullPath);
    }
  };
  walk(nodes, []);
  return out;
}

// ---------- course skill (.skill) ----------

function skillFrontmatter(config: CourseFullConfig): string {
  const name = `${slugName(config.name)}-question-import`;
  const description = `Convert source documents (exam papers, worksheets, assessments, PDFs, images of questions) into import-ready JSON for the ${config.name} question bank, with correct node ids, question types, difficulty levels and marking guides. Use this skill whenever the user uploads or pastes ${config.name} questions or an exam and wants them extracted, digitised, classified, imported into the question bank, or turned into the question-bank JSON format, even if they do not mention the skill or JSON explicitly. Only valid for the ${config.name} course.`;
  if (!description || !description.trim()) {
    throw new Error("Skill validation failed: description is required.");
  }
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Skill validation failed: name must be kebab-case (got '${name}').`);
  }
  return `---
name: ${name}
description: "${description.replace(/"/g, '\\"')}"
---

`;
}

export function buildSkillMarkdown(config: CourseFullConfig, instructionsMarkdown: string): string {
  let diffRange = "as configured";
  if (config.difficulty_levels.length) {
    const levels = config.difficulty_levels.map((d) => d.level);
    diffRange = `${Math.min(...levels)}\u2013${Math.max(...levels)}`;
  }
  return `${skillFrontmatter(config)}# Document-to-Question Skill — ${config.name}

This skill converts source documents (exam papers, worksheets, assessments)
into the question-bank's structured JSON import format, for **this specific
course only**. It combines the general extraction process with the exact
structure, categories, and rules ${config.name} uses — do not apply this to a
different course without downloading that course's own skill file, since
node ids, question types, and difficulty labels are course-specific and
will not resolve against another course's database.

## Process

1. Read the entire source document before extracting anything, so multi-part
   questions, shared stems, and diagrams referenced across pages are handled
   correctly rather than piecemeal.
2. Identify each individual question (or question with parts). Preserve the
   original question numbering only as source metadata — never let it drive
   the app's own display order.
3. For each question, extract in order: question text, equations (as LaTeX),
   diagrams/images (describe what should be extracted; this skill cannot
   extract binary image data itself), tables (as structured
   columns/rows, not flattened text), and lists. Whenever a question needs a
   diagram/image that can't be extracted, **keep a running note of its
   original question number** so you can report it in the Image attachment
   checklist (see below).
   **Format mathematical notation, scientific notation, symbols, and units
   for rendering.** Use an equation block for standalone equations. For math
   inside prose, choices, table cells, or list items, wrap LaTeX in single
   dollar signs, e.g. $v = 3.0\\times10^{8}\\,\\mathrm{m/s}$. Never leave
   powers as plain 10^8 or use plain x for multiplication.
4. Determine the question type, difficulty, marks, and classification
   (course nodes) using the course-specific section below — never guess a
   category that doesn't appear in "VALID NODES"; if uncertain, use the
   nearest matching node's parent instead of inventing one, and note the
   classification confidence honestly.
5. **Every question must end up with a marking guide** (see "Marking guides"
   below) — this is not optional, even when the source material doesn't
   include one.
6. Produce a single JSON file (see "Output format") containing every
   extracted question. Do not import anything yourself — the person uploads
   this file into the app.

## Image attachment checklist

Because this skill extracts text, equations, tables, and lists but **cannot
extract binary image data**, every finished response must end with an
**Image attachment checklist** that tells the person exactly which questions
need images attached and where they are in the source. This is not optional
— it is the only way the person knows what's missing.

- Track every question needing manual attachment **by its original source
  question number** (the same number you put in each question's
  \`source.original_question_no\`), plus its part label if it's a multi-part
  question — the app's question ids don't exist yet, so question numbers are
  the only reliable reference.
- End the response with a checklist like this:

\`\`\`
## Image attachment checklist

- Q17 (b): circuit diagram — two long parallel wires above a rectangular loop, AC source
- Q22: force-vs-time graphs A\u2013D for the rocket's thrust
- Q34: scatter plot of V0/V vs 1/\u03bb with five data points
\`\`\`

- If no question needs an image, still include the section and write
  "None — every question is fully text/equations." A missing section reads
  as an omission, not as "none needed".
- The person attaches these via the app's block editor upload picker after
  import.

## Marking guides — required, and never an exemplar

Every question in the output must have a \`marking_criteria\` field (in
addition to \`answer\`/\`solution\` if the source provides them):

- If the source document already gives marking criteria (a rubric, a mark
  scheme, "1 mark for X, 1 mark for Y"), use it as given, reworded into the
  block format below if needed.
- **If the exam document gives no marking criteria, create them yourself**
  for every question or part, using the question wording, its marks value,
  difficulty, and course context (topic/dot point) to decide what a response
  must demonstrate to earn each mark. For example, a 3-mark short-answer
  question might earn "1 mark for
  correctly identifying X; 1 mark for the correct method; 1 mark for the
  correct final answer with appropriate units."
- **Do not write a full worked exemplar answer or model solution as the
  marking guide.** A marking guide describes what to check for and how marks
  are allocated — it is a checklist for a marker, not a sample response. If
  you also have or can produce a worked solution, put that in the separate
  \`solution\` field instead; keep \`marking_criteria\` focused on grading
  criteria only.
- Marking criteria should be given as a \`list\` content block (one item per
  criterion/mark) wherever practical, since that's the clearest format for a
  marker to check off against.
- **Every criterion item must state its mark allocation up front** — the app
  renders the marking guide as a two-column table (criteria | marks), so
  write each item as \`"<allocation> marks: <what to look for>"\` (or
  \`"<allocation> marks for <what to look for>"\`), allocating a single mark
  or a band, e.g. \`"1 mark: correctly identifies X"\`, \`"2 marks: sets up
  the correct equation"\`, or \`"1–2 marks: partial method with one slip"\`.
  A trailing parenthesised allocation (\`"... correctly (2 marks)"\`) also
  works. Avoid vague criteria with no allocation — an unmallocated line
  shows an empty marks cell in the table.

## Output format

Produce **one JSON file** (e.g. \`import.json\`) shaped like this:

\`\`\`json
{
  "schema_version": 1,
  "course_id": "${config.course_id}",
  "course_name": "${config.name}",
  "questions": [
    {
      "type_key": "short_answer",
      "difficulty": 3,
      "marks": 3,
      "node_ids": ["<a valid node_id from import-schema.json>"],
      "node_codes": ["<the matching code from import-schema.json for the node_id above>"],
      "tags": ["optional", "free-text", "tags"],
      "body": [
        {"block_type": "text", "content": {"text": "..."}},
        {"block_type": "equation", "content": {"latex": "x^2 - 5x + 6 = 0", "display": true}}
      ],
      "answer": [{"block_type": "text", "content": {"text": "..."}}],
      "solution": [],
      "marking_criteria": [
        {"block_type": "list", "content": {"ordered": false, "items": [
          "1 mark: correctly extracts the coefficients",
          "1 mark: applies the quadratic formula correctly",
          "1 mark: correct final answer"
        ]}}
      ],
      "classification_confidence": "high",
      "source": {"name": "Trial Examination", "year": 2025, "original_question_no": "17"}
    }
  ]
}
\`\`\`

## Multiple-choice questions

For every question whose \`type_key\` is \`multiple_choice\`, keep the question
stem in \`body\` and put answer choices in a separate \`mcq_options\` array. Do
not put choices in a body list. Keep stem blocks in the order they appear on
the page, and keep options in their printed order (A, B, C, D). Each option
has a \`content\` array of normal content blocks and an \`is_correct\` boolean.
Use inline LaTeX for math in option text. Mark exactly one option correct
when the source establishes the answer; also set \`answer\` to its letter (for
example, \`C\`). If the source does not establish the answer, set every
\`is_correct\` to \`false\` and leave \`answer\` empty rather than guessing.
Preserve diagrams, tables, and equations in the stem or option content where
they occur. Do not create question parts for the choices.

Example:

\`\`\`json
{
  "type_key": "multiple_choice",
  "body": [{"block_type": "text", "content": {"text": "What is the temperature?"}}],
  "mcq_options": [
    {"content": [{"block_type": "text", "content": {"text": "$1.6\\\\times10^{12}$ K"}}], "is_correct": false},
    {"content": [{"block_type": "text", "content": {"text": "$5.2\\\\times10^{3}$ K"}}], "is_correct": true}
  ],
  "answer": [{"block_type": "text", "content": {"text": "B"}}]
}
\`\`\`

Fill in \`source.original_question_no\` for **every** question (and give each
multi-part part a \`part_label\`) — the Image attachment checklist references
questions by these same numbers, so they must match exactly what's printed
on the source paper.

See \`import-schema.json\` (packaged alongside this file) for this course's
actual valid \`node_ids\`, \`node_codes\`, \`node_names\`, \`type_key\` values,
and difficulty range (${diffRange}) — every \`node_ids\` entry in your output
must be one of the \`node_id\` values listed there, with its matching
\`node_codes\` entry (the \`code\` on the same row), and every \`type_key\`
must be one of the listed valid types.

**Always fill in both \`node_ids\` and \`node_codes\`, and include
\`course_name\`.** Course and node ids are regenerated whenever the course is
re-imported (e.g. after a reset), but node \`code\`s, the course
\`course_name\`, and the full node paths in \`node_names\` (e.g. \`Module /
Topic / Subtopic\` from \`valid_node_names\`) stay stable. Including them lets
the app re-match questions to the correct nodes even after the ids change, and
lets the file be matched to a re-created course by name. Quote the ids, codes,
names, and course name exactly as shown in \`import-schema.json\`.

Content block types available for \`body\`/\`answer\`/\`solution\`/\`marking_criteria\`:
\`text\`, \`heading\`, \`equation\` (LaTeX in \`latex\`, \`display\`),
\`image\`/\`diagram\`/\`graph\` (include the image description in the content
and flag the question in the Image attachment checklist — see step 3),
\`table\` (\`columns\`, \`rows\`), \`list\` (\`ordered\`, \`items\`), \`code\`
(\`language\`, \`code\`), \`answer_area\` (\`lines\`), \`page_break\`.

## Handling uncertainty

- Multi-part questions: emit one question object for the shared stem, with
  a \`parts\` array of \`{"part_label": "a", "marks": ..., "body": [...],
  "marking_criteria": [...]}\` objects — do not split them into unrelated
  top-level questions.
- For multi-part \`extended_response\`, \`short_response\`, or \`short_answer\`
  questions, include an \`answer_area\` block at the end of each part's \`body\`
  so answer lines appear immediately after that part. Set \`content.lines\` to
  two lines per mark (round fractional results up, with at least one line),
  based on that part's \`marks\`; for example, a 2-mark part gets
  \`{"block_type":"answer_area","content":{"lines":4}}\`. Do not put one
  long answer area on the shared parent question. Leave answer areas off
  multiple-choice parts and parts whose source already provides a specific
  answer space.
- If a question spans multiple valid nodes, list all of them in \`node_ids\`
  (and the matching codes in \`node_codes\`) — only if the course allows
  multiple classification — see below.
- If you cannot confidently classify a question at all, still include it,
  set \`classification_confidence\` to \`"low"\`, and pick the closest available
  node rather than leaving \`node_ids\` empty.

---

${instructionsMarkdown}`;
}

export async function buildSkillBlob(
  config: CourseFullConfig,
  instructionsMarkdown: string
): Promise<Blob> {
  const skillMd = buildSkillMarkdown(config, instructionsMarkdown);
  const importSchema = {
    course_id: config.course_id,
    course_name: config.name,
    schema_version: 1,
    valid_type_keys: config.question_types,
    valid_difficulty_levels: config.difficulty_levels.map((d) => ({ level: d.level, label: d.label })),
allow_multi_classification: config.allow_multi_classification,
    valid_node_ids: flattenNodes(config.nodes),
    valid_node_codes: flattenNodes(config.nodes)
      .map((n) => n.code)
      .filter((c): c is string => !!c),
    valid_node_names: flattenNodes(config.nodes).map((n) => n.path),
    mcq_option_format: {
      content: "array of content blocks, same block format as body",
      is_correct: "boolean; mark exactly one true when the answer is known",
      order: "array order is the printed choice order; labels A, B, C... are implicit",
    },
    example_question: {
      type_key: config.question_types[0] ?? "short_answer",
      difficulty: config.difficulty_levels[0]?.level ?? null,
      marks: 3,
      node_ids: [],
      node_codes: [],
      node_names: [],
      tags: [],
      body: [
        { block_type: "text", content: { text: "Example question text." } },
        { block_type: "equation", content: { latex: "x^2 - 5x + 6 = 0", display: true } },
      ],
      answer: [{ block_type: "text", content: { text: "x = 2, x = 3" } }],
      solution: [],
      marking_criteria: [
        {
          block_type: "list",
          content: {
            ordered: false,
            items: [
              "1 mark: uses the correct formula",
              "1 mark: correct working shown",
              "1 mark: correct final answer",
            ],
          },
        },
      ],
      classification_confidence: "high",
      source: { name: "Example Source", year: 2025, original_question_no: "1" },
    },
    example_multiple_choice: {
      type_key: "multiple_choice",
      body: [{ block_type: "text", content: { text: "What is the temperature?" } }],
      mcq_options: [
        { content: [{ block_type: "text", content: { text: "$1.6\\times10^{12}$ K" } }], is_correct: false },
        { content: [{ block_type: "text", content: { text: "$5.2\\times10^{3}$ K" } }], is_correct: true },
      ],
      answer: [{ block_type: "text", content: { text: "B" } }],
    },
  };
  const zip = new JSZip();
  zip.file("SKILL.md", skillMd);
  zip.file("import-schema.json", JSON.stringify(importSchema, null, 2));
  return zip.generateAsync({ type: "blob" });
}

export async function downloadSkill(courseId: string): Promise<void> {
  const config = await data.getCourseFullConfig(courseId);
  if (!config) throw new Error("Course not found");
  const instructions = await data.getInstructions(courseId);
  const blob = await buildSkillBlob(config, instructions.instructions_markdown);
  downloadBlob(blob, `${slugName(config.name)}.skill`);
}

// ---------- course export (.qb) ----------

function mimeExtension(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    default: return "bin";
  }
}

export async function exportCourse(courseId: string): Promise<void> {
  const config = await data.getCourseFullConfig(courseId);
  if (!config) throw new Error("Course not found");
  const row = await data.getCourseRow(courseId);
  const questions = await data.getCourseQuestions(courseId);
  const zip = new JSZip();
  zip.file(
    "course.json",
    JSON.stringify(
      {
        export_schema_version: 1,
        exported_at: new Date().toISOString(),
        course: {
          ...config,
          description: row?.description ?? null,
          subject: row?.subject ?? null,
          curriculum: row?.curriculum ?? null,
          version_year: row?.version_year ?? null,
        },
        questions,
      },
      null,
      2
    )
  );
  const seen = new Set<string>();
  const collectIds = (q: Question) => {
    for (const a of q.assets) if (!seen.has(a.asset_id)) seen.add(a.asset_id);
    for (const p of q.parts) collectIds(p);
  };
  for (const q of questions) collectIds(q);
  for (const assetId of seen) {
    const blob = await idb.getAsset(assetId);
    if (!blob) continue;
    zip.file(`assets/${assetId}.${mimeExtension(blob.type || "")}`, blob);
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, `${slugName(config.name)}.qb`);
}

/** Export the question records and their binary assets without course configuration. */
export async function exportQuestions(courseId: string): Promise<void> {
  const config = await data.getCourseFullConfig(courseId);
  if (!config) throw new Error("Course not found");
  const questions = await data.getCourseQuestions(courseId);
  const zip = new JSZip();
  zip.file("questions.json", JSON.stringify({
    export_schema_version: 1,
    course_name: config.name,
    exported_at: new Date().toISOString(),
    questions,
  }, null, 2));
  zip.file("README.txt", "Editable question export. Edit questions.json; binary files referenced by asset_id are in assets/. Keep asset IDs and filenames unchanged so image blocks continue to resolve. This package contains no course structure or settings.\n");
  const seen = new Set<string>();
  const collectIds = (q: Question) => {
    for (const a of q.assets) if (!seen.has(a.asset_id)) seen.add(a.asset_id);
    for (const p of q.parts) collectIds(p);
  };
  for (const q of questions) collectIds(q);
  for (const assetId of seen) {
    const blob = await idb.getAsset(assetId);
    if (blob) zip.file(`assets/${assetId}.${mimeExtension(blob.type || "")}`, blob);
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${slugName(config.name)}-questions.qbx`);
}

// ---------- course import (.qb) ----------

export interface ParsedBundle {
  course: CourseFullConfig & {
    description?: string | null;
    subject?: string | null;
    curriculum?: string | null;
    version_year?: string | null;
  };
  questions: Question[];
  assetBlobs: Map<string, Blob>;
}

export async function parseCourseBundle(file: File): Promise<ParsedBundle> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(file);
  } catch {
    throw new Error("This file is not a valid .qb course bundle.");
  }
  const courseJsonFile = archive.file("course.json");
  if (!courseJsonFile) {
    throw new Error("This .qb bundle has no course.json — it may be corrupted.");
  }
  const courseJson = JSON.parse(await courseJsonFile.async("string"));
  if (courseJson.export_schema_version !== 1) {
    throw new Error(
      `Unsupported export schema version ${courseJson.export_schema_version} — this app supports version 1.`
    );
  }
  const assetBlobs = new Map<string, Blob>();
  const assetFolder = archive.folder("assets");
  if (assetFolder) {
    for (const path in assetFolder.files) {
      const entry = assetFolder.files[path];
      if (entry.dir) continue;
      const name = path.split("/").pop() ?? "";
      const assetId = name.split(".").slice(0, -1).join(".") || name;
      if (!assetBlobs.has(assetId)) assetBlobs.set(assetId, await entry.async("blob"));
    }
  }
  return { course: courseJson.course, questions: courseJson.questions ?? [], assetBlobs };
}

async function wipeCourseData(courseId: string): Promise<void> {
  const rows = await all("SELECT question_id FROM question WHERE course_id = ?", [courseId]);
  const ids = rows.map((r) => r.question_id);
  if (ids.length) {
    const marks = ids.map(() => "?").join(", ");
    await run(`DELETE FROM practice_attempt WHERE question_id IN (${marks})`, ids);
    await run(
      `UPDATE import_question SET final_question_id = NULL WHERE final_question_id IN (${marks})`,
      ids
    );
  }
  await run("DELETE FROM practice_session WHERE course_id = ?", [courseId]);
  const assetRows = await all(
    `SELECT asset_id FROM asset
     WHERE question_id IN (SELECT question_id FROM question WHERE course_id = ?)`,
    [courseId]
  );
  const { deleteAssetBlob } = await import("./assets");
  for (const row of assetRows) await deleteAssetBlob(row.asset_id);
  await run("DELETE FROM course WHERE course_id = ?", [courseId]);
}

const IMAGE_TYPES = new Set(["image", "diagram", "graph"]);

interface ImportCtx {
  courseId: string;
  nodeMap: Map<string, string>;
  questionMap: Map<string, string>;
  assetMap: Map<string, string>;
}

async function getOrCreateTag(courseId: string, name: string): Promise<string> {
  const row = await getFirst("SELECT tag_id FROM tag WHERE course_id = ? AND name = ?", [
    courseId,
    name,
  ]);
  if (row) return row.tag_id;
  const tagId = newId("tag");
  await run("INSERT INTO tag (tag_id, course_id, name) VALUES (?, ?, ?)", [tagId, courseId, name]);
  return tagId;
}

async function insertSourceIfNeeded(question: Question): Promise<string | null> {
  const s = question.source;
  if (!s || !s.name) return null;
  const candidates = await all("SELECT source_id, year, institution FROM source WHERE name = ?", [
    s.name,
  ]);
  for (const c of candidates) {
    if ((c.year ?? null) === (s.year ?? null) && (c.institution ?? null) === (s.institution ?? null)) {
      return c.source_id;
    }
  }
  const sourceId = newId("src");
  await run(
    "INSERT INTO source (source_id, name, year, institution, original_question_no) VALUES (?, ?, ?, ?, ?)",
    [sourceId, s.name, s.year ?? null, s.institution ?? null, s.original_question_no ?? null]
  );
  return sourceId;
}

async function insertQuestion(
  question: Question,
  ctx: ImportCtx,
  sourceAlready: Map<string, string | null>
): Promise<string> {
  const questionId = newId("q");
  ctx.questionMap.set(question.question_id, questionId);
  const parentId = question.parent_question_id
    ? (ctx.questionMap.get(question.parent_question_id) ?? null)
    : null;
  const sourceKey = question.source ? JSON.stringify(question.source) : "";
  let sourceId = sourceKey ? (sourceAlready.get(sourceKey) ?? null) : null;
  if (sourceKey && !sourceId) {
    sourceId = await insertSourceIfNeeded(question);
    sourceAlready.set(sourceKey, sourceId);
  }
  await run(
    `INSERT INTO question (question_id, course_id, type_key, difficulty, marks, parent_question_id,
        part_label, notes, review_status, classification_confidence, source_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      questionId,
      ctx.courseId,
      question.type_key,
      question.difficulty,
      question.marks,
      parentId,
      question.part_label,
      question.notes,
      question.review_status,
      question.classification_confidence,
      sourceId,
      question.created_at,
      question.updated_at,
    ]
  );
  question.node_ids.forEach((nodeId, i) => {
    const mapped = ctx.nodeMap.get(nodeId) ?? nodeId;
    run(
      "INSERT INTO question_classification (question_id, node_id, is_primary) VALUES (?, ?, ?)",
      [questionId, mapped, i === 0 ? 1 : 0]
    );
  });
  for (const tag of question.tags ?? []) {
    const tagId = await getOrCreateTag(ctx.courseId, tag);
    await run("INSERT INTO question_tag (question_id, tag_id) VALUES (?, ?)", [questionId, tagId]);
  }
  const slotLists: Array<[string, Question["body"]]> = [
    ["body", question.body],
    ["answer", question.answer],
    ["solution", question.solution],
    ["marking_criteria", question.marking_criteria],
  ];
  for (const [slot, blocks] of slotLists) {
    for (let i = 0; i < (blocks ?? []).length; i++) {
      const b = blocks[i];
      let content = b.content;
      if (IMAGE_TYPES.has(b.block_type) && typeof content?.asset_path === "string") {
        const mapped = ctx.assetMap.get(content.asset_path);
        if (mapped) content = { ...content, asset_path: mapped };
      }
      await run(
        "INSERT INTO content_block (block_id, question_id, slot, position, block_type, content_json) VALUES (?, ?, ?, ?, ?, ?)",
        [newId("blk"), questionId, slot, i, b.block_type, JSON.stringify(content ?? {})]
      );
    }
  }
  for (const a of question.assets ?? []) {
    const mapped = ctx.assetMap.get(a.asset_id) ?? a.asset_id;
    await run(
      `INSERT INTO asset (asset_id, question_id, file_path, mime_type, width, height, alt_text, caption, original_filename)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [mapped, questionId, mapped, a.mime_type, a.width, a.height, a.alt_text, a.caption, null]
    );
  }
  for (const part of question.parts ?? []) {
    await insertQuestion(part, ctx, sourceAlready);
  }
  return questionId;
}

export async function applyCourseBundle(
  bundle: ParsedBundle,
  mode: "replace" | "new"
): Promise<string> {
  const src = bundle.course;
  const courseId = mode === "new" ? newId("course") : src.course_id;
  if (mode === "replace") {
    await wipeCourseData(courseId);
  }
  const ctx: ImportCtx = { courseId, nodeMap: new Map(), questionMap: new Map(), assetMap: new Map() };

  // re-key asset ids that would collide with blobs already in the store
  const existingAssets = new Set(await idb.listAssetIds());
  if (mode === "new") {
    for (const assetId of bundle.assetBlobs.keys()) {
      if (existingAssets.has(assetId)) ctx.assetMap.set(assetId, newId("asset"));
      else ctx.assetMap.set(assetId, assetId);
    }
  } else {
    for (const assetId of bundle.assetBlobs.keys()) ctx.assetMap.set(assetId, assetId);
  }

  const now = nowUtc();
  await run(
    `INSERT INTO course (course_id, name, description, subject, curriculum, version_year,
        schema_version, allow_multi_classification, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      courseId,
      src.name,
      src.description ?? null,
      src.subject ?? null,
      src.curriculum ?? null,
      src.version_year ?? null,
      src.schema_version ?? 1,
      src.allow_multi_classification ? 1 : 0,
      now,
      now,
    ]
  );
  for (const level of src.hierarchy ?? []) {
    await run(
      "INSERT INTO course_level_def (course_id, level_index, label, required) VALUES (?, ?, ?, ?)",
      [courseId, level.level_index, level.label, level.required ? 1 : 0]
    );
  }
  for (const d of src.difficulty_levels ?? []) {
    await run("INSERT INTO difficulty_level (course_id, level, label) VALUES (?, ?, ?)", [
      courseId,
      d.level,
      d.label,
    ]);
  }
  const existingTypes = await all("SELECT type_key FROM question_type");
  const typeSet = new Set(existingTypes.map((r) => r.type_key));
  for (const key of src.question_types ?? []) {
    if (!typeSet.has(key)) {
      await run("INSERT INTO question_type (type_key, display_name) VALUES (?, ?)", [
        key,
        key
          .split("_")
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
          .join(" "),
      ]);
    }
  }
  for (const tag of src.tags ?? []) {
    await getOrCreateTag(courseId, tag);
  }
  // nodes, parents before children (pre-order walk)
  const fullFlat: CourseNode[] = [];
  const walkAll = (list: CourseNode[]) => {
    for (const n of list) {
      fullFlat.push(n);
      walkAll(n.children);
    }
  };
  walkAll(src.nodes ?? []);
  for (const node of fullFlat) {
    const nodeId = newId("node");
    ctx.nodeMap.set(node.node_id, nodeId);
    await run(
      `INSERT INTO course_node (node_id, course_id, parent_node_id, level_index, name, code, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nodeId,
        courseId,
        node.parent_node_id ? (ctx.nodeMap.get(node.parent_node_id) ?? null) : null,
        node.level_index,
        node.name,
        node.code,
        node.description,
        node.sort_order,
        now,
        now,
      ]
    );
  }

  const sourceAlready = new Map<string, string | null>();
  for (const q of bundle.questions) {
    await insertQuestion(q, ctx, sourceAlready);
  }
  for (const [assetId, blob] of bundle.assetBlobs) {
    await idb.putAsset(ctx.assetMap.get(assetId) ?? assetId, blob);
  }
  return courseId;
}

export async function importCourseFile(file: File): Promise<{ course_id: string; course_name: string }> {
  const bundle = await parseCourseBundle(file);
  const existing = await getFirst("SELECT course_id FROM course WHERE course_id = ?", [
    bundle.course.course_id,
  ]);
  let courseId: string;
  if (existing) {
    const replace = window.confirm(
      `A course with id '${bundle.course.course_id}' already exists. Replace it with the imported one, or add as a new course?`
    );
    if (replace) {
      courseId = await applyCourseBundle(bundle, "replace");
    } else {
      courseId = await applyCourseBundle(bundle, "new");
    }
  } else {
    courseId = await applyCourseBundle(bundle, "new");
  }
  return { course_id: courseId, course_name: bundle.course.name };
}
