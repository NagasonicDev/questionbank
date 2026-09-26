"""
The "Download Course Skill" feature (§31-34 of the design doc, formalized).

A .skill file is just a zip (renamed) containing:
  - SKILL.md            general document-to-question instructions, PLUS this
                         course's specific structure/classification/marking
                         rules, so the whole thing is self-contained — a
                         person hands this single file to an LLM alongside a
                         source exam and gets back an import-ready JSON file.
  - import-schema.json  a concrete reference for the JSON the agent must
                         produce: this course's valid node ids (with full
                         path for readability), valid question types, valid
                         difficulty levels, and an example question object.
  - course-config.json  the full hydrated course config, for anything the
                         agent needs that isn't already spelled out in
                         SKILL.md.

The produced JSON is meant to be handed back to this app via
POST /api/v1/courses/{course_id}/import-json (see routers/import_pipeline.py).
"""
import io
import json
import zipfile

from . import schemas


def _flatten_nodes(nodes: list[schemas.CourseNodeOut], path: list[str] | None = None) -> list[dict]:
    path = path or []
    out = []
    for n in nodes:
        full_path = path + [n.name]
        out.append({
            "node_id": n.node_id,
            "name": n.name,
            "code": n.code,
            "level_index": n.level_index,
            "path": " > ".join(full_path),
        })
        out.extend(_flatten_nodes(n.children, full_path))
    return out


def build_skill_markdown(config: schemas.CourseFullConfig, instructions_markdown: str) -> str:
    diff_range = ""
    if config.difficulty_levels:
        levels = [d.level for d in config.difficulty_levels]
        diff_range = f"{min(levels)}\u2013{max(levels)}"

    return f"""# Document-to-Question Skill — {config.name}

This skill converts source documents (exam papers, worksheets, assessments)
into the question-bank's structured JSON import format, for **this specific
course only**. It combines the general extraction process with the exact
structure, categories, and rules {config.name} uses — do not apply this to a
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
   extract binary image data itself — flag image locations for the person to
   attach manually after import, via the app's block editor), tables
   (as structured columns/rows, not flattened text), and lists.
   **Format mathematical notation, scientific notation, symbols, and units
   for rendering.** Use an `equation` block for standalone equations. For math
   inside prose, choices, table cells, or list items, wrap LaTeX in single
   dollar signs, e.g. `$v = 3.0\\times10^{8}\\,\\mathrm{m/s}$`. Never leave
   powers as plain `10^8` or use plain `x` for multiplication.
4. Determine the question type, difficulty, marks, and classification
   (course nodes) using the course-specific section below — never guess a
   category that doesn't appear in "Valid categories"; if uncertain, use the
   nearest matching node's parent instead of inventing one, and note the
   classification confidence honestly.
5. **Every question must end up with a marking guide** (see "Marking guides"
   below) — this is not optional, even when the source material doesn't
   include one.
6. Produce a single JSON file (see "Output format") containing every
   extracted question. Do not import anything yourself — the person uploads
   this file into the app.

## Marking guides — required, and never an exemplar

Every question in the output must have a `marking_criteria` field (in
addition to `answer`/`solution` if the source provides them):

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
  `solution` field instead; keep `marking_criteria` focused on grading
  criteria only.
- Marking criteria should be given as a `list` content block (one item per
  criterion/mark) wherever practical, since that's the clearest format for a
  marker to check off against.
- **Every criterion item must state its mark allocation up front** — the app
  renders the marking guide as a two-column table (criteria | marks), so
  write each item as `\"<allocation> marks: <what to look for>\"` (or
  `\"<allocation> marks for <what to look for>\"`), allocating a single mark
  or a band, e.g. `\"1 mark: correctly identifies X\"`, `\"2 marks: sets up
  the correct equation\"`, or `\"1–2 marks: partial method with one slip\"`.
  A trailing parenthesised allocation (`\"... correctly (2 marks)\"`) also
  works. Avoid vague criteria with no allocation — an unmallocated line
  shows an empty marks cell in the table.

## Output format

Produce **one JSON file** (e.g. `import.json`) shaped like this:

```json
{{
  "schema_version": 1,
  "course_id": "{config.course_id}",
  "questions": [
    {{
      "type_key": "short_answer",
      "difficulty": 3,
      "marks": 3,
      "node_ids": ["<a valid node_id from import-schema.json>"],
      "tags": ["optional", "free-text", "tags"],
      "body": [
        {{"block_type": "text", "content": {{"text": "..."}}}},
        {{"block_type": "equation", "content": {{"latex": "x^2 - 5x + 6 = 0", "display": true}}}}
      ],
      "answer": [{{"block_type": "text", "content": {{"text": "..."}}}}],
      "solution": [],
      "marking_criteria": [
        {{"block_type": "list", "content": {{"ordered": false, "items": [
          "1 mark: correctly extracts the coefficients",
          "1 mark: applies the quadratic formula correctly",
          "1 mark: correct final answer"
        ]}}}}
      ],
      "classification_confidence": "high",
      "source": {{"name": "Trial Examination", "year": 2025, "original_question_no": "17"}}
    }}
  ]
}}
```

## Multiple-choice questions

For every question whose `type_key` is `multiple_choice`, keep the question
stem in `body` and put answer choices in a separate `mcq_options` array. Do
not put choices in a body list. Keep stem blocks in the order they appear on
the page, and keep options in their printed order (A, B, C, D). Each option
has a `content` array of normal content blocks and an `is_correct` boolean.
Use inline LaTeX for math in option text. Mark exactly one option correct
when the source establishes the answer; also set `answer` to its letter (for
example, `C`). If the source does not establish the answer, set every
`is_correct` to `false` and leave `answer` empty rather than guessing.
Preserve diagrams, tables, and equations in the stem or option content where
they occur. Do not create question parts for the choices.

Example:

```json
{{
  "type_key": "multiple_choice",
  "body": [{{"block_type": "text", "content": {{"text": "What is the temperature?"}}}}],
  "mcq_options": [
    {{"content": [{{"block_type": "text", "content": {{"text": "$1.6\\\\times10^12$ K"}}}}], "is_correct": false}},
    {{"content": [{{"block_type": "text", "content": {{"text": "$5.2\\\\times10^3$ K"}}}}], "is_correct": true}}
  ],
  "answer": [{{"block_type": "text", "content": {{"text": "B"}}}}]
}}
```

See `import-schema.json` (packaged alongside this file) for this course's
actual valid `node_ids`, `type_key` values, and difficulty range
({diff_range or "as configured"}) — every `node_ids` entry in your output
must be one of the `node_id` values listed there, and every `type_key` must
be one of the listed valid types.

Content block types available for `body`/`answer`/`solution`/`marking_criteria`:
`text`, `heading`, `equation` (LaTeX in `latex`, `display: true/false`),
`image`/`diagram`/`graph` (flag these for manual attachment — see step 3),
`table` (`columns`, `rows`), `list` (`ordered`, `items`), `code`
(`language`, `code`), `answer_area` (`lines`), `page_break`.

Inline math uses `$...$` within `text`, `heading`, `list.items`, and table
cell strings. Use `\\times`, braces for exponents, and `\\,\\mathrm{unit}`
for upright SI units. Example choice: `"(A) $5.4\\times10^{14}\\,\\mathrm{Hz}$"`.

## Handling uncertainty

- Multi-part questions: emit one question object for the shared stem, with
  a `parts` array of `{{"part_label": "a", "marks": ..., "body": [...],
  "marking_criteria": [...]}}` objects in the same order as the source — do
  not split them into unrelated top-level questions.
- For multi-part `extended_response`, `short_response`, or `short_answer`
  questions, include an `answer_area` block at the end of each part's `body`
  so answer lines appear immediately after that part. Set `content.lines` to
  two lines per mark (round fractional results up, with at least one line),
  based on that part's `marks`; for example, a 2-mark part gets
  `{"block_type":"answer_area","content":{"lines":4}}`. Do not put one
  long answer area on the shared parent question. Leave answer areas off
  multiple-choice parts and parts whose source already provides a specific
  answer space.
- If a question spans multiple valid nodes, list all of them in `node_ids`
  (only if the course allows multiple classification — see below).
- If you cannot confidently classify a question at all, still include it,
  set `classification_confidence` to `"low"`, and pick the closest available
  node rather than leaving `node_ids` empty.

---

{instructions_markdown}
"""


def build_skill_zip(config: schemas.CourseFullConfig, instructions_markdown: str) -> bytes:
    skill_md = build_skill_markdown(config, instructions_markdown)

    import_schema = {
        "course_id": config.course_id,
        "course_name": config.name,
        "schema_version": 1,
        "valid_type_keys": config.question_types,
        "valid_difficulty_levels": [{"level": d.level, "label": d.label} for d in config.difficulty_levels],
        "allow_multi_classification": config.allow_multi_classification,
        "valid_node_ids": _flatten_nodes(config.nodes),
        "valid_tags": config.tags,
        "mcq_option_format": {
            "content": "array of content blocks, same block format as body",
            "is_correct": "boolean; mark exactly one true when the answer is known",
            "order": "array order is the printed choice order; labels A, B, C... are implicit",
        },
        "example_question": {
            "type_key": config.question_types[0] if config.question_types else "short_answer",
            "difficulty": config.difficulty_levels[0].level if config.difficulty_levels else None,
            "marks": 3,
            "node_ids": [],
            "tags": [],
            "body": [
                {"block_type": "text", "content": {"text": "Example question text."}},
                {"block_type": "equation", "content": {"latex": "x^2 - 5x + 6 = 0", "display": True}},
            ],
            "answer": [{"block_type": "text", "content": {"text": "x = 2, x = 3"}}],
            "solution": [],
            "marking_criteria": [
                {"block_type": "list", "content": {"ordered": False, "items": [
                    "1 mark: uses the correct formula",
                    "1 mark: correct working shown",
                    "1 mark: correct final answer",
                ]}}
            ],
            "classification_confidence": "high",
            "source": {"name": "Example Source", "year": 2025, "original_question_no": "1"},
        },
        "example_multiple_choice": {
            "type_key": "multiple_choice",
            "body": [{"block_type": "text", "content": {"text": "What is the temperature?"}}],
            "mcq_options": [
                {"content": [{"block_type": "text", "content": {"text": "$1.6\\times10^12$ K"}}], "is_correct": False},
                {"content": [{"block_type": "text", "content": {"text": "$5.2\\times10^3$ K"}}], "is_correct": True},
            ],
            "answer": [{"block_type": "text", "content": {"text": "B"}}],
        },
    }

    course_config_json = json.loads(config.model_dump_json())

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("SKILL.md", skill_md)
        zf.writestr("import-schema.json", json.dumps(import_schema, indent=2))
        zf.writestr("course-config.json", json.dumps(course_config_json, indent=2))
    return buf.getvalue()
