import {
  AlignmentType,
  BorderStyle,
  ShadingType,
  Document,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
  type ParagraphChild,
} from "docx";
import type { ContentBlock, Question } from "../api/types";
import { contentOf, criteriaRows, formatMarks, formatSourceBracket, marksLabel } from "./criteria";
import { inlineMathImageId, resolveEquations, resolveImages, type ResolvedImage } from "./resolvers";
import {
  EXAM,
  buildExamPaperPlan,
  formatMcOption,
  generalInstructionsLines,
  isMcOptionLine,
  sectionOpeningLines,
  sectionOverviewLines,
} from "./examLayout";

const GRAY = "6B6B64";
const RULE_COLOR = "999999";

const ptH = (pt: number) => pt * 2;
const inches = (n: number) => convertInchesToTwip(n);
/** A4 */
const PAGE_W_IN = 8.27;
const PAGE_H_IN = 11.69;
const MARGIN_IN = 0.75;
const MARKS_TAB_IN = 7.05;

export interface DocSection {
  label: string | null;
  questions: Question[];
}

export interface DocOptions {
  title: string;
  courseName: string;
  achievedMarks: number;
  sections: DocSection[];
}

function runProps(opts: {
  text: string;
  bold?: boolean;
  italics?: boolean;
  color?: string;
  sizePt?: number;
    font?: string;
}): TextRun {
  return new TextRun({
    text: opts.text,
    bold: opts.bold,
    italics: opts.italics,
    color: opts.color,
    size: opts.sizePt !== undefined ? ptH(opts.sizePt) : ptH(EXAM.font.bodyPt),
    font: { name: opts.font ?? EXAM.font.family },
  });
}

function borderBottom(color = RULE_COLOR, size = 6, space = 1) {
  return { style: BorderStyle.SINGLE, size, space, color };
}

function tableGridBorders() {
  const all = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  return {
    top: all,
    bottom: all,
    left: all,
    right: all,
    insideHorizontal: all,
    insideVertical: all,
  };
}

function imageRun(img: ResolvedImage): ImageRun {
  const ext = (img.mime.split("/")[1] ?? "png").replace("jpeg", "jpg");
  const type = (ext === "png" || ext === "jpg" || ext === "gif" ? ext : "png") as
    | "png"
    | "jpg"
    | "gif";
  return new ImageRun({
    type,
    data: img.data,
    transformation: { width: img.widthPx, height: img.heightPx },
  });
}

function inlineRuns(blockId: string, text: string, images: Map<string, ResolvedImage>, index: { value: number }): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  const re = /\$([^$]+)\$/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) children.push(runProps({ text: text.slice(last, match.index) }));
    const math = images.get(inlineMathImageId(blockId, index.value++));
    if (math) children.push(imageRun(math));
    else children.push(runProps({ text: match[1] }));
    last = re.lastIndex;
  }
  if (last < text.length) children.push(runProps({ text: text.slice(last) }));
  return children.length ? children : [runProps({ text })];
}

// ---------- block rendering ----------

function blocksOfQuestion(
  question: Question,
  slots: Array<"body" | "answer" | "solution" | "marking_criteria">
): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const s of slots) {
    for (const b of question[s]) out.push(b);
  }
  return out;
}

function renderBlock(
  block: ContentBlock,
  opts: { indentIn: number; images: Map<string, ResolvedImage> }
): Array<Paragraph | Table> {
  const { indentIn, images } = opts;
  const out: Array<Paragraph | Table> = [];
  const left = inches(indentIn);
  switch (block.block_type) {
    case "text": {
      const text = contentOf(block, "text", "");
      if (typeof text === "string" && text) {
        out.push(
          new Paragraph({ children: inlineRuns(block.block_id, text, images, { value: 0 }), indent: { left } })
        );
      }
      break;
    }
    case "heading": {
      const text = contentOf(block, "text", "");
      if (typeof text === "string" && text) {
        out.push(
          new Paragraph({
            children: inlineRuns(block.block_id, text, images, { value: 0 }),
            indent: { left },
          })
        );
      }
      break;
    }
    case "equation": {
      const latex = contentOf(block, "latex", "");
      const display = contentOf(block, "display", true) !== false;
      const resolved = images.get(block.block_id);
      if (resolved) {
        const para = new Paragraph({
          children: [imageRun(resolved)],
          alignment: display ? AlignmentType.CENTER : AlignmentType.START,
          indent: display ? undefined : { left },
        });
        out.push(para);
      } else {
        out.push(
          new Paragraph({
            children: [
              runProps({
                text: typeof latex === "string" ? latex.replace(/\\(?:left|right)\b/g, "").replace(/\\(?:,|;|!|quad|qquad)/g, " ") : "",
                font: EXAM.font.family,
                sizePt: 11,
              }),
            ],
            alignment: display ? AlignmentType.CENTER : AlignmentType.START,
            indent: display ? undefined : { left },
          })
        );
      }
      break;
    }
    case "image":
    case "diagram":
    case "graph": {
      const path = contentOf(block, "asset_path");
      const caption = contentOf(block, "caption");
      const resolved = images.get(block.block_id);
      if (!resolved) {
        out.push(
          new Paragraph({
            children: [
              runProps({
                text: `[missing image: ${typeof path === "string" ? path : ""}]`,
                italics: true,
              }),
            ],
          })
        );
      } else {
        const targetIn = Math.min(4.5, 6.5 - indentIn);
        const widthPx = Math.round(targetIn * 96);
        const heightPx = Math.round((resolved.heightPx / resolved.widthPx) * widthPx);
        const img = { ...resolved, widthPx, heightPx };
        out.push(
          new Paragraph({
            children: [imageRun(img)],
            alignment: AlignmentType.CENTER,
          })
        );
        if (caption) {
          out.push(
            new Paragraph({
              children: [runProps({ text: caption, italics: true, sizePt: 9, color: GRAY })],
              alignment: AlignmentType.CENTER,
            })
          );
        }
      }
      break;
    }
    case "table": {
      const columns: unknown = contentOf(block, "columns", []);
      const rows: unknown = contentOf(block, "rows", []);
      if (Array.isArray(columns) && Array.isArray(rows)) {
        const widthIn = 6.5 - indentIn;
        const colWidthTwips = Math.round(inches(widthIn) / Math.max(1, columns.length));
        const inlineMathIndex = { value: 0 };
        const buildRow = (cells: unknown[], header: boolean): TableRow => {
          const normalized = Array.from({ length: columns.length }, (_, i) => cells[i]);
          const cellChildren = normalized.map((c) => {
            const val = String(c ?? "");
            return new TableCell({
              children: [
                new Paragraph({
                  children: inlineRuns(block.block_id, val, images, inlineMathIndex),
                  alignment: AlignmentType.CENTER,
                }),
              ],
              width: { size: colWidthTwips, type: WidthType.DXA },
              margins: { top: 80, bottom: 80, left: 100, right: 100 },
              verticalAlign: "center",
              ...(header ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: "F1F1EE" } } : {}),
            });
          });
          return new TableRow({ children: cellChildren });
        };
        const headerCells = columns.map((c) => String(c ?? ""));
        const bodyRows = rows.map((r) => (Array.isArray(r) ? r : []));
        out.push(
          new Table({
            alignment: AlignmentType.CENTER,
            borders: tableGridBorders(),
            columnWidths: headerCells.map(() => colWidthTwips),
            width: { size: inches(widthIn), type: WidthType.DXA },
            layout: "fixed",
            rows: [buildRow(headerCells, true), ...bodyRows.map((r) => buildRow(r, false))],
          })
        );
      }
      break;
    }
    case "list": {
      const items: unknown = contentOf(block, "items", []);
      const ordered = contentOf(block, "ordered", false) === true;
      if (Array.isArray(items)) {
        const mc =
          !ordered && items.length > 0 && items.every((it) => isMcOptionLine(String(it ?? "")));
        const inlineMathIndex = { value: 0 };
        for (const item of items) {
          const text = mc ? formatMcOption(String(item ?? "")) : String(item ?? "");
          if (mc) {
            out.push(
              new Paragraph({
                indent: { left: inches(indentIn + 0.35) },
                children: inlineRuns(block.block_id, text, images, inlineMathIndex),
              })
            );
          } else {
            out.push(
              new Paragraph({
                numbering: {
                  reference: ordered ? "listNumber" : "listBullet",
                  level: 0,
                },
                indent: { left: inches(indentIn + 0.25) },
                children: inlineRuns(block.block_id, text, images, inlineMathIndex),
              })
            );
          }
        }
      }
      break;
    }
    case "code": {
      const code = contentOf(block, "code", "");
      const language = contentOf(block, "language");
      const text = typeof code === "string" ? code : "";
      const parts2 = typeof language === "string" && language ? ` (${language})` : "";
      const intro = parts2
        ? new Paragraph({
            children: [
              runProps({
                text: parts2.trim(),
                italics: true,
                sizePt: 8,
                color: GRAY,
              }),
            ],
            indent: { left: inches(indentIn + 0.15) },
          })
        : null;
      if (intro) out.push(intro);
      for (const line of text.split("\n")) {
        out.push(
          new Paragraph({
            children: [runProps({ text: line, font: "Courier New", sizePt: 10 })],
            indent: { left: inches(indentIn + 0.15) },
          })
        );
      }
      break;
    }
    case "answer_area": {
      const lines = Math.max(1, Number(contentOf(block, "lines", 3)) || 1);
      for (let i = 0; i < lines; i++) {
        const p = new Paragraph({
          children: [runProps({ text: "" })],
          spacing: { after: 14 * 20 },
          border: { bottom: borderBottom() },
          indent: { left },
        });
        out.push(p);
      }
      break;
    }
    case "page_break": {
      out.push(new Paragraph({ children: [new PageBreak()] }));
      break;
    }
  }
  return out;
}

function renderBlocks(
  blocks: ContentBlock[],
  opts: { indentIn: number; images: Map<string, ResolvedImage> }
): Array<Paragraph | Table> {
  const sorted = [...blocks].sort((a, b) => a.position - b.position);
  const out: Array<Paragraph | Table> = [];
  for (const b of sorted) out.push(...renderBlock(b, opts));
  return out;
}

function criteriaTable(question: Question): { table: Table | null; hasRows: boolean; supplementary: ContentBlock[] } {
  const { rows, hasRows, supplementary } = criteriaRows(question.marking_criteria);
  if (!hasRows) return { table: null, hasRows, supplementary };
  const nbsp = "\u00A0";
  const cell = (text: string, header: boolean, center: boolean): TableCell =>
    new TableCell({
      children: [
        new Paragraph({
          children: [runProps({ text: text || nbsp, bold: header })],
          alignment: center ? AlignmentType.CENTER : AlignmentType.START,
        }),
      ],
    });
const table = new Table({
    alignment: AlignmentType.CENTER,
    borders: tableGridBorders(),
    columnWidths: [inches(4.6), inches(0.9)],
    width: { size: inches(5.5), type: WidthType.DXA },
    rows: [
      new TableRow({ children: [cell("Criteria", true, false), cell("Marks", true, true)] }),
      ...rows.map((r) =>
        new TableRow({
          children: [cell(r.criteria, false, false), cell(r.marks, false, true)],
        })
      ),
    ],
  });
  return { table, hasRows, supplementary };
}

function questionHeader(question: Question, counter: { n: number }): Paragraph {
  counter.n += 1;
  const n = counter.n;
  const marks = formatMarks(question.marks);
  const children: ParagraphChild[] = [runProps({ text: `Question ${n}`, bold: true })];
  if (marks) {
    children.push(new Tab());
    children.push(runProps({ text: marks }));
  }
  return new Paragraph({
    children,
    spacing: { before: 14 * 20 },
    tabStops: [
      {
        type: TabStopType.RIGHT,
        position: inches(MARKS_TAB_IN),
      },
    ],
  });
}

function renderQuestion(
  question: Question,
  counter: { n: number },
  images: Map<string, ResolvedImage>
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  out.push(questionHeader(question, counter));
  out.push(...renderBlocks(question.body, { indentIn: 0, images }));
  for (const part of question.parts) {
    const labelText = part.part_label ?? "";
    const marks = marksLabel(part.marks);
    const headChildren = [
      runProps({
        text: labelText ? `(${labelText})` : "",
        bold: true,
        sizePt: 12,
      }),
    ];
    if (marks) headChildren.push(runProps({ text: `  [${marks}]`, sizePt: 9 }));
    out.push(
      new Paragraph({ children: headChildren, indent: { left: inches(0.3) } })
    );
    out.push(...renderBlocks(part.body, { indentIn: 0.3, images }));
  }
  const src = formatSourceBracket(question.source);
  if (src) {
    out.push(
      new Paragraph({
        children: [runProps({ text: src, italics: true, sizePt: 8, color: GRAY })],
      })
    );
  }
  return out;
}

// ---------- cover ----------

function boxedParagraphs(lines: string[]): Table {
  const cellParas = lines.map((line) =>
    new Paragraph({
      children: [
        runProps({
          text: line,
          bold: line === "General Instructions",
          sizePt: line === "General Instructions" ? EXAM.font.bodyPt : EXAM.font.bodyPt,
        }),
      ],
      spacing: { after: line === "" ? 80 : 40 },
    })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableGridBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: cellParas,
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
          }),
        ],
      }),
    ],
  });
}

function hscCoverPage(children: Array<Paragraph | Table>, opts: DocOptions): void {
  const plan = buildExamPaperPlan(opts);
  children.push(
    new Paragraph({
      children: [runProps({ text: EXAM.certificateLine, bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [runProps({ text: plan.subjectLine, bold: true, sizePt: EXAM.font.coverTitlePt })],
      alignment: AlignmentType.CENTER,
    })
  );
  if (plan.paperTitle && plan.paperTitle !== plan.subjectLine) {
    children.push(
      new Paragraph({
        children: [runProps({ text: plan.paperTitle })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    );
  } else {
    children.push(new Paragraph({ spacing: { after: 200 } }));
  }

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: tableGridBorders(),
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({ children: [runProps({ text: "Centre Number", sizePt: EXAM.font.smallPt })] }),
                new Paragraph({ spacing: { after: 240 } }),
                new Paragraph({ children: [runProps({ text: "Student Number", sizePt: EXAM.font.smallPt })] }),
              ],
              margins: { top: 120, bottom: 120, left: 160, right: 160 },
            }),
          ],
        }),
      ],
    })
  );

  children.push(
    boxedParagraphs(generalInstructionsLines(plan)),
    new Paragraph({ spacing: { before: 240 } }),
    new Paragraph({
      children: [runProps({ text: "Examination structure", bold: true })],
      spacing: { after: 80 },
    })
  );

  for (const sec of plan.sections) {
    for (const line of sectionOverviewLines(sec)) {
      children.push(
        new Paragraph({
          children: [runProps({ text: line || " ", sizePt: EXAM.font.bodyPt })],
          indent: line ? { left: inches(0.35) } : undefined,
          spacing: { after: line === "" ? 60 : 40 },
        })
      );
    }
    children.push(new Paragraph({ spacing: { after: 120 } }));
  }

  children.push(
    new Paragraph({
      children: [runProps({ text: plan.examDate, sizePt: EXAM.font.smallPt, color: GRAY })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ children: [new PageBreak()] })
  );
}

function appendSectionHeader(children: Array<Paragraph | Table>, sec: ReturnType<typeof buildExamPaperPlan>["sections"][number]) {
  for (const line of sectionOpeningLines(sec)) {
    if (line === "") {
      children.push(new Paragraph({ spacing: { after: 60 } }));
    } else if (line === sec.title) {
      children.push(
        new Paragraph({
          children: [runProps({ text: line, bold: true, sizePt: EXAM.font.titlePt })],
          spacing: { before: 240, after: 80 },
        })
      );
    } else if (line.endsWith(" marks")) {
      children.push(new Paragraph({ children: [runProps({ text: line, bold: true })], spacing: { after: 80 } }));
    } else {
      children.push(new Paragraph({ children: [runProps({ text: line })], spacing: { after: 60 } }));
    }
  }
}

function pack(children: Array<Paragraph | Table>): Promise<Blob> {
  const numbering = {
    config: [
      {
        reference: "listNumber",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: inches(0.5) } } },
          },
        ],
      },
      {
        reference: "listBullet",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "\u2022",
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: inches(0.5) } } },
          },
        ],
      },
    ],
  };
  const doc = new Document({
    numbering,
    styles: {
      default: {
        document: {
          run: { font: EXAM.font.family, size: ptH(EXAM.font.bodyPt) },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: inches(PAGE_W_IN), height: inches(PAGE_H_IN) },
            margin: {
              top: inches(MARGIN_IN),
              bottom: inches(MARGIN_IN),
              left: inches(MARGIN_IN),
              right: inches(MARGIN_IN),
            },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}

// ---------- public builders ----------

async function collectImages(sections: DocSection[]): Promise<Map<string, ResolvedImage>> {
  const blocks: ContentBlock[] = [];
  for (const sec of sections) {
    for (const q of sec.questions) {
      blocks.push(...blocksOfQuestion(q, ["body", "answer", "solution", "marking_criteria"]));
      for (const part of q.parts) {
        blocks.push(...blocksOfQuestion(part, ["body", "answer", "solution", "marking_criteria"]));
      }
    }
  }
  const [images, equations] = await Promise.all([resolveImages(blocks), resolveEquations(blocks)]);
  for (const [id, img] of equations) images.set(id, img);
  return images;
}

export async function buildDocxPaper(opts: DocOptions): Promise<Blob> {
  const images = await collectImages(opts.sections);
  const plan = buildExamPaperPlan(opts);
  const children: Array<Paragraph | Table> = [];
  hscCoverPage(children, opts);
  const counter = { n: 0 };
  let planIdx = 0;
  for (const sec of opts.sections) {
    if (!sec.questions.length) continue;
    const secPlan = plan.sections[planIdx++];
    if (!secPlan) continue;
    if (planIdx > 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    appendSectionHeader(children, secPlan);
    for (const q of sec.questions) {
      children.push(...renderQuestion(q, counter, images));
    }
  }
  return pack(children);
}

export async function buildDocxSolutions(opts: DocOptions): Promise<Blob> {
  const dateStr = todayPretty();
  const images = await collectImages(opts.sections);
  const children: Array<Paragraph | Table> = [];
  children.push(
    new Paragraph({
      children: [runProps({ text: `Solutions — ${opts.title}`, bold: true, sizePt: 18 })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [runProps({ text: `${opts.courseName}  ·  ${dateStr}`, sizePt: 10, color: GRAY })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ children: [runProps({ text: "" })] })
  );
  const counter = { n: 0 };
  for (const sec of opts.sections) {
    if (sec.label) {
      children.push(
        new Paragraph({
          children: [runProps({ text: sec.label, bold: true, sizePt: 13 })],
          spacing: { before: 16 * 20 },
        })
      );
    }
    for (const q of sec.questions) {
      renderSolutionQuestion(q, counter, images, children);
    }
  }
  return pack(children);
}

function renderSolutionQuestion(
  question: Question,
  counter: { n: number },
  images: Map<string, ResolvedImage>,
  out: Array<Paragraph | Table>
): void {
  out.push(questionHeader(question, counter));
  const { table, hasRows, supplementary } = criteriaTable(question);
  if (hasRows) {
    out.push(new Paragraph({ children: [runProps({ text: "Marking guide:", italics: true })] }));
    if (table) out.push(table);
    if (supplementary.length) {
      out.push(
        new Paragraph({ children: [runProps({ text: "Detailed marking notes:", italics: true })] })
      );
      out.push(...renderBlocks(supplementary, { indentIn: 0.2, images }));
    }
  }
  if (question.answer.length) {
    out.push(new Paragraph({ children: [runProps({ text: "Answer:", italics: true })] }));
    out.push(...renderBlocks(question.answer, { indentIn: 0.2, images }));
  }
  if (question.solution.length) {
    out.push(
      new Paragraph({ children: [runProps({ text: "Solution / working:", italics: true })] })
    );
    out.push(...renderBlocks(question.solution, { indentIn: 0.2, images }));
  }
  if (!hasRows && !question.answer.length && !question.solution.length) {
    out.push(
      new Paragraph({
        children: [
          runProps({ text: "No marking guide recorded for this question.", italics: true }),
        ],
      })
    );
  }
}

function todayPretty(): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const d = new Date();
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
