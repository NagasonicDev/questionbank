# Local Question Bank (client-only)

A complete question bank that runs **entirely in your browser**. There is no
server, no database server, and nothing to install beyond Node.js (only needed
to serve the static files when running locally). Courses, questions, images,
and past tests are stored in your browser's own storage, so the app also
deploys to a static host like GitHub Pages with no backend at all.

## What it does

- **Course structure** — Courses hold a configurable multi-level hierarchy
  (Topic → Subtopic → Dot Point, or whatever a course needs). Build it out in
  **Course Settings → Structure**: add, rename, reorder, nest, delete levels
  and categories.
- **Questions** — Full block-based content editor (**Course Settings →
  Questions**): text, headings, **equations** (LaTeX, rendered with KaTeX),
  images/diagrams/graphs (with a real file picker), tables, ordered/unordered
  lists, code blocks, answer areas, and page breaks. Multi-part questions
  share a stem with labelled parts. Every question has an independent
  **marking guide** (criteria + mark allocation), plus optional answer and
  solution.
- **Browse & search** — `#/browse` filters, searches, sorts and paginates the
  whole bank; `#/` dashboard shows totals, breakdowns, and the hierarchy tree
  with live question counts.
- **Practice** — `#/practice`: pick filters, get a random matching question,
  **Submit** to reveal the **Marking Guide first** (rendered as a
  criteria|marks table), then Answer, then Solution. Attempts are logged and
  feed the **Recent Questions** sidebar.
- **Test Generator** — `#/test-generator`: compose a paper from fully
  configurable sections (question counts or marks targets, per question type)
  and download **two documents**: a clean test **paper** and a standalone
  **solutions/marking-guide** document, in **DOCX** or **PDF**, with a PDF
  preview. Equations are typeset with KaTeX and embedded as images; uploaded
  images are embedded too. Every generated test is kept under **Past Tests**,
  re-downloadable and re-previewable.
- **Course skill** — Download a per-course `.skill` file (SKILL.md +
  import-schema.json + course-config.json) to hand — together with a source
  document — to an AI assistant to get back an import-ready JSON file. The
  skill enforces the marking-guide rule (criteria required, never a full
  worked exemplar as the guide).
- **JSON import pipeline** — `#/import`: upload the JSON the skill produced;
  each question validates independently (rejections say why, bad questions
  never block good ones; missing marking guides warn, don't fail).
- **Export / Import** — Export any course as a single `.qb` zip (course +
  questions + images); import it back on another browser/machine, either
  replacing the existing copy or adding as a new course.
- **Dark mode** & a responsive layout served from a single page with hash
  routing (`#/practice`, etc.) so deep links work on any static host.

## Where your data lives

Everything is stored in **your browser profile**:

- A SQLite database (run in-browser via [SQLite](https://sql.js.org/)) holding
  courses, questions, hierarchy, practice history, and past-test records —
  persisted to **IndexedDB** under the store `qb`.
- Uploaded images/diagrams stored as blobs in the same IndexedDB database.
- Generated DOCX/PDF files, also in IndexedDB, download-able from Past Tests.

There is no cloud and no server: your data stays on the machine you use. Two
things follow from this:

1. **Different browsers/profiles have separate data.** Moving a course to
   another machine, browser, or browser profile is a matter of one `.qb`
   export and one import — that's exactly what the file is for.
2. **Clearing your browser's site data wipes the app's data.** Export `.qb`
   backups of anything you care about (and keep the `.qb` files somewhere
   safe) if you plan to clear browsing data or change browsers. The `.qb`
   format is versioned (`export_schema_version: 1`) and stores the full course
   config, all questions, and every image.

## Run it

Only **Node.js 18+** (with npm) is required.

### One-click launcher

- **macOS:** double-click `Start QuestionBank.command`
- **Windows:** double-click `Start QuestionBank.bat`
- **Linux:** run `./start.sh` (or double-click it if your file manager runs
  `.sh` scripts)

First run installs the frontend dependencies (one or two minutes, only once).
Each launch rebuilds the static bundle so code changes are picked up
automatically, then opens `http://127.0.0.1:8420/questionbank/` in seconds.
Leave the terminal window it opens running while you use the app; closing it
stops the app. The launcher only serves static files (`vite preview`) — there
is no backend to start.

For instant reload while editing, use Developer mode below instead of
restarting the launcher each time.

### Developer mode (hot reload)

```bash
cd frontend
npm install
npm run dev      # serves at http://localhost:5173/questionbank/
```

Any changes save instantly. Build a production bundle with `npm run build`
(runs the TypeScript check first) and preview it with `npm run preview`.

### On GitHub Pages

Push to the `main` branch — `.github/workflows/deploy.yml` builds `frontend`
and deploys `dist` to GitHub Pages under the **`/questionbank/`** base path.
Hash routing means no server-side rewrites are needed. Because the app is
client-only, the deployed site behaves exactly like the local one, but with
per-browser data (see above) — the `.qb` format is the bridge between them.

## Project layout

```
Start QuestionBank.command   - double-click launcher (macOS)
Start QuestionBank.bat        - double-click launcher (Windows)
start.sh                       - launcher (Linux / manual macOS)
backend/                       - retired: the original FastAPI backend. The
                                 app no longer uses it and is fully
                                 client-side now; kept only as a reference.
frontend/
  public/
    sql-wasm.wasm              - SQLite wasm build (served at /questionbank/)
    favicon.svg, icons.svg
  src/
    main.tsx, App.tsx          - app shell, theme, HashRouter, routes
    api/types.ts               - shared TypeScript types (Course, Question,
                                 ContentBlock, ...)
    pages/
      Dashboard.tsx            - totals, breakdowns, topic tree with counts
      Browser.tsx              - search/filter/sort/paginate the bank
      Practice.tsx             - filters -> random question -> reveal flow
      TestGenerator.tsx        - configure sections -> DOCX/PDF paper+solutions
      QuestionDetail.tsx
      CourseSettings.tsx       - structure + question management
      Import.tsx               - JSON import + .qb import/export + skill download
      Settings.tsx
    components/
      CourseSelector.tsx, CreateCourseForm.tsx, NodeTree.tsx, Layout.tsx,
      FilterMenu.tsx, QuestionReader.tsx, QuestionEditor.tsx,
      BlockEditor.tsx, StructureEditor.tsx, RecentQuestionsSidebar.tsx
    hooks/                     - useActiveCourse, useCourseConfig, useTheme
    lib/
      db/sqlite.ts             - sql.js wrapper: queries, transactions,
                                 persistence via IndexedDB (debounced)
      db/schema.ts             - SQLite schema + built-in question types
      db/indexeddb.ts          - IndexedDB store 'qb' (database bytes, blobs,
                                 generated test files)
      data.ts                  - all read/write operations (courses,
                                 questions, practice, tests, import)
      exchange.ts              - .qb export/import, .skill download
      criteria.ts              - marking-guide parsing -> criteria|marks rows
      resolvers.ts             - images/equations -> embeddable PNGs (shared
                                 by DOCX + PDF export)
      equations.ts             - KaTeX -> tight-fitting PNG (html-to-image)
      docx.ts, pdf.ts          - DOCX (docx lib) and PDF (pdf-lib) builders
      tests.ts                 - generated-test archives in IndexedDB
      assets.ts                - staged image upload -> question assets
  package.json, vite.config.ts  - base '/questionbank/', assets in app-assets/
```

## Verified working

Type-checks clean (`tsc -b`), lints clean (oxlint), and builds cleanly
(`vite build`). The build embeds the KaTeX fonts used to typeset equations,
and the full loop — create course → build hierarchy → add questions with the
block editor → practice a random question → generate a DOCX/PDF test with
solutions → export/import `.qb` — has been exercised end-to-end in a browser.