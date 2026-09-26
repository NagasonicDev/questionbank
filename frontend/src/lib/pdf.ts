import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PageSizes,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import notoSerifRegularUrl from "../assets/NotoSerif-Regular.ttf?url";
import notoSerifBoldUrl from "../assets/NotoSerif-Bold.ttf?url";
import notoSerifItalicUrl from "../assets/NotoSerif-Italic.ttf?url";
import type { ContentBlock, Question } from "../api/types";
import { contentOf, criteriaRows, formatMarks, formatSourceBracket, marksLabel } from "./criteria";
import { inlineMathImageId, resolveEquations, resolveImages, type ResolvedImage } from "./resolvers";
import type { DocSection } from "./docx";
import {
  EXAM,
  buildExamPaperPlan,
  formatMcOption,
  formatPageNumber,
  isWrittenResponseType,
  responseLinesForMarks,
  generalInstructionsLines,
  isMcOptionLine,
  sectionOpeningLines,
  sectionOverviewLines,
  type ExamPaperPlan,
} from "./examLayout";

const PT = 72;
const PAGE_W = EXAM.page.widthPt;
const PAGE_H = EXAM.page.heightPt;
const MARGIN_L = EXAM.margin.left;
const MARGIN_R = EXAM.margin.right;
const MARGIN_T = EXAM.margin.top;
const MARGIN_B = EXAM.margin.bottom;
const MARKS_COL = EXAM.margin.marks;
const BODY_W = PAGE_W - MARGIN_L - MARGIN_R - MARKS_COL;
const TOP = PAGE_H - MARGIN_T;
const BOTTOM = MARGIN_B + 20;
const FOOTER_Y = MARGIN_B - 4;

const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.42, 0.42, 0.39);
const BORDER = rgb(0.6, 0.6, 0.6);
const HR = rgb(0.8, 0.8, 0.8);
const HEADER_BG = rgb(0.945, 0.945, 0.933);

const LINE_H = (size: number) => size * EXAM.font.lineHeight;

interface Fonts {
  reg: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
}

async function embedUnicodeFonts(pdf: PDFDocument): Promise<Fonts> {
  pdf.registerFontkit(fontkit);
  const [reg, bold, italic] = await Promise.all([
    notoSerifRegularUrl,
    notoSerifBoldUrl,
    notoSerifItalicUrl,
  ].map(async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer())));
  return {
    reg: await pdf.embedFont(reg, { subset: true }),
    bold: await pdf.embedFont(bold, { subset: true }),
    italic: await pdf.embedFont(italic, { subset: true }),
    mono: await pdf.embedFont(reg, { subset: true }),
  };
}

const charSets = new WeakMap<PDFFont, Set<number>>();
function pdfSafeText(text: string, font: PDFFont): string {
  let chars = charSets.get(font);
  if (!chars) { chars = new Set(font.getCharacterSet()); charSets.set(font, chars); }
  const replacements: Record<string, string> = { "√": "sqrt ", "−": "-", "→": "->" };
  return Array.from(text, (c) => chars!.has(c.codePointAt(0)!) ? c : replacements[c] ?? `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`).join("");
}
function drawSafeText(page: ReturnType<PDFDocument["addPage"]>, text: string, opts: Parameters<ReturnType<PDFDocument["addPage"]>["drawText"]>[1] & { font: PDFFont }) {
  page.drawText(pdfSafeText(text, opts.font), opts);
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  text = pdfSafeText(text, font);
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean).flatMap((word) => {
      if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
      const parts: string[] = [];
      let part = "";
      for (const ch of word) {
        if (part && font.widthOfTextAtSize(part + ch, size) > maxWidth) {
          parts.push(part);
          part = ch;
        } else part += ch;
      }
      if (part) parts.push(part);
      return parts;
    });
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

class Writer {
  pdf: PDFDocument;
  fonts: Fonts;
  page: { page: ReturnType<PDFDocument["addPage"]>; w: number; h: number };
  y = TOP;

  constructor(pdf: PDFDocument, fonts: Fonts) {
    this.pdf = pdf;
    this.fonts = fonts;
    // Field initializers run before the constructor body, so `page` must be
    // created here — otherwise `this.pdf` is still undefined when addPage runs.
    this.page = this.newPageRef();
  }

  pageNumber = 1;

  private newPageRef() {
    const p = this.pdf.addPage(PageSizes.A4);
    const w = p.getWidth();
    const h = p.getHeight();
    return { page: p, w, h };
  }

  drawPageFooter() {
    const label = formatPageNumber(this.pageNumber);
    const size = EXAM.font.smallPt;
    const font = this.fonts.reg;
    const tw = font.widthOfTextAtSize(label, size);
    drawSafeText(this.page.page, label, {
      x: MARGIN_L + (BODY_W + MARKS_COL - tw) / 2,
      y: FOOTER_Y,
      size,
      font,
      color: BLACK,
    });
  }

  newPage() {
    this.drawPageFooter();
    this.pageNumber += 1;
    this.page = this.newPageRef();
    this.y = TOP;
  }

  ensure(space: number) {
    if (this.y - space < BOTTOM) this.newPage();
  }

  /** Marks sit in the right-hand margin (NESA Principle 12). */
  drawMarks(marks: string, lineY?: number) {
    if (!marks) return;
    const size = EXAM.font.bodyPt;
    const font = this.fonts.reg;
    marks = pdfSafeText(marks, font);
    const y = lineY ?? this.y;
    const tw = font.widthOfTextAtSize(marks, size);
    drawSafeText(this.page.page, marks, {
      x: MARGIN_L + BODY_W + MARKS_COL - tw - 2,
      y,
      size,
      font,
      color: BLACK,
    });
  }

  /** Draw a border around content written since `startY` (top baseline). */
  finishBox(startY: number, pad = 10) {
    const height = startY - this.y + pad;
    if (height < 8) return;
    this.page.page.drawRectangle({
      x: MARGIN_L,
      y: this.y - pad / 2,
      width: BODY_W + MARKS_COL,
      height,
      borderColor: BORDER,
      borderWidth: 0.75,
    });
    this.y -= pad / 2;
  }

  text(text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center"; indent?: number } = {}) {
    const size = opts.size ?? EXAM.font.bodyPt;
    const font = opts.font ?? this.fonts.reg;
    const color = opts.color ?? BLACK;
    const align = opts.align ?? "left";
    const indent = opts.indent ?? 0;
    const maxW = BODY_W - indent;
    for (const line of wrapText(font, text, size, maxW)) {
      this.ensure(LINE_H(size));
      const x =
        align === "left"
          ? MARGIN_L + indent
          : align === "right"
            ? MARGIN_L + BODY_W - font.widthOfTextAtSize(line, size)
            : MARGIN_L + (BODY_W - font.widthOfTextAtSize(line, size)) / 2;
      drawSafeText(this.page.page, line, { x, y: this.y, size, font, color });
      this.y -= LINE_H(size);
    }
  }

  textLine(line: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; align?: "left" | "right" | "center" }) {
    const size = opts.size ?? EXAM.font.bodyPt;
    const font = opts.font ?? this.fonts.reg;
    line = pdfSafeText(line, font);
    const x =
      opts.x ??
      (opts.align === "right"
        ? MARGIN_L + BODY_W - font.widthOfTextAtSize(line, size)
        : opts.align === "center"
          ? MARGIN_L + (BODY_W - font.widthOfTextAtSize(line, size)) / 2
          : MARGIN_L);
    this.ensure(LINE_H(size));
    drawSafeText(this.page.page, line, { x, y: this.y, size, font, color: opts.color ?? BLACK });
    this.y -= LINE_H(size);
  }

  rule(color = HR) {
    this.ensure(6);
    this.page.page.drawLine({
      start: { x: MARGIN_L, y: this.y + 3 },
      end: { x: MARGIN_L + BODY_W + MARKS_COL, y: this.y + 3 },
      thickness: 0.75,
      color,
    });
    this.y -= 9;
  }

  spacer(h: number) {
    this.ensure(h);
    this.y -= h;
  }

  async gridRow(cells: string[], widths: number[], opts: { font?: PDFFont; fill?: ReturnType<typeof rgb>; align?: "right" | "center"; inline?: { images: Map<string, ResolvedImage>; blockId: string; index: { value: number } } } = {}) {
    const x0 = MARGIN_L;
    const font = opts.font ?? this.fonts.reg;
    const size = 9;
    const lineH = LINE_H(size);
    const normalized = widths.map((_, i) => cells[i] ?? "");
    const wrapped = normalized.map((cell, i) => wrapText(font, cell, size, Math.max(1, widths[i] - 8)));
    const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
    const height = Math.max(20, lineCount * lineH + 8);
    this.ensure(height);
    const rowTop = this.y;
    let cx = x0;
    for (let i = 0; i < normalized.length; i++) {
      const cellW = widths[i];
      if (opts.fill) {
        this.page.page.drawRectangle({ x: cx, y: this.y - height, width: cellW, height, color: opts.fill });
      }
      const lines = wrapped[i];
      const textH = lines.length * lineH;
      let ty = rowTop - (height - textH) / 2 - lineH;
      if (opts.inline && /\$[^$]+\$/.test(normalized[i])) {
        const parts: Array<{ text: string; image?: PDFImage }> = [];
        const re = /\$([^$]+)\$/g;
        let last = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(normalized[i]))) {
          if (match.index > last) parts.push({ text: normalized[i].slice(last, match.index) });
          const resolved = opts.inline.images.get(inlineMathImageId(opts.inline.blockId, opts.inline.index.value++));
          parts.push(resolved ? { text: "", image: await this.pdf.embedPng(resolved.data) } : { text: match[1] });
          last = re.lastIndex;
        }
        if (last < normalized[i].length) parts.push({ text: normalized[i].slice(last) });
        const widthsOfParts = parts.map((part) => part.image ? (part.image.width / part.image.height) * size * 1.2 : font.widthOfTextAtSize(part.text, size));
        let px = cx + (cellW - widthsOfParts.reduce((sum, value) => sum + value, 0)) / 2;
        for (let pi = 0; pi < parts.length; pi++) {
          const part = parts[pi];
          const partWidth = widthsOfParts[pi];
          if (part.image) this.page.page.drawImage(part.image, { x: px, y: ty - size * 0.25, width: partWidth, height: size * 1.2 });
          else if (part.text) drawSafeText(this.page.page, part.text, { x: px, y: ty, size, font, color: BLACK });
          px += partWidth;
        }
      } else for (const line of lines) {
        const textW = font.widthOfTextAtSize(line, size);
        const lx =
          opts.align === "right"
            ? cx + cellW - 3 - textW
            : opts.align === "center"
              ? cx + (cellW - textW) / 2
              : cx + (cellW - textW) / 2;
        drawSafeText(this.page.page, line, { x: lx, y: ty, size, font, color: BLACK });
        ty -= lineH;
      }
      cx += cellW;
    }
    this.page.page.drawRectangle({
      x: x0,
      y: rowTop - height,
      width: widths.reduce((sum, width) => sum + width, 0),
      height,
      borderColor: BORDER,
      borderWidth: 0.5,
    });
    let vx = x0;
    for (const width of widths.slice(0, -1)) {
      vx += width;
      this.page.page.drawLine({ start: { x: vx, y: rowTop }, end: { x: vx, y: rowTop - height }, thickness: 0.5, color: BORDER });
    }
    this.y -= height;
  }

  async richText(text: string, images: Map<string, ResolvedImage>, blockId: string, opts: { indent?: number; size?: number; font?: PDFFont; mathIndex?: { value: number } } = {}) {
    const size = opts.size ?? EXAM.font.bodyPt;
    const font = opts.font ?? this.fonts.reg;
    text = pdfSafeText(text, font);
    const maxW = BODY_W - (opts.indent ?? 0);
    const x0 = MARGIN_L + (opts.indent ?? 0);
    const tokens: Array<{ text: string; image?: ResolvedImage }> = [];
    const re = /\$([^$]+)\$/g;
    let last = 0;
    let match: RegExpExecArray | null;
    const mathIndex = opts.mathIndex ?? { value: 0 };
    while ((match = re.exec(text))) {
      tokens.push(...text.slice(last, match.index).split(/(\s+)/).filter(Boolean).map((t) => ({ text: t })));
      const math = images.get(inlineMathImageId(blockId, mathIndex.value++));
      tokens.push(math ? { text: "", image: math } : { text: match[1] });
      last = re.lastIndex;
    }
    tokens.push(...text.slice(last).split(/(\s+)/).filter(Boolean).map((t) => ({ text: t })));
    let x = x0;
    let lineHasContent = false;
    const newLine = () => { this.y -= LINE_H(size); x = x0; lineHasContent = false; };
    for (const token of tokens) {
      const embedded = token.image ? await this.pdf.embedPng(token.image.data) : null;
      const width = embedded ? (embedded.width / embedded.height) * size * 1.2 : font.widthOfTextAtSize(token.text, size);
      if (x + width > x0 + maxW && lineHasContent) newLine();
      this.ensure(LINE_H(size));
      if (embedded) this.page.page.drawImage(embedded, { x, y: this.y - size * 0.25, width, height: size * 1.2 });
      else if (token.text.trim()) drawSafeText(this.page.page, token.text, { x, y: this.y, size, font, color: BLACK });
      x += width;
      lineHasContent ||= Boolean(token.text.trim() || embedded);
    }
    this.y -= LINE_H(size);
  }

  fitImage(img: PDFImage, opts: { maxW: number; maxH?: number }) {
    const w = img.width;
    const h = img.height;
    let dw = opts.maxW;
    let dh = (h / w) * dw;
    if (opts.maxH && dh > opts.maxH) {
      dh = opts.maxH;
      dw = (w / h) * dh;
    }
    const x = MARGIN_L + (BODY_W - dw) / 2;
    this.ensure(dh + 4);
    this.page.page.drawImage(img, { x, y: this.y - dh, width: dw, height: dh });
    this.y -= dh + 4;
  }
}

function contentBlocks(question: Question, slots: Array<"body" | "answer" | "solution" | "marking_criteria">): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const s of slots) for (const b of question[s]) blocks.push(b);
  return blocks;
}

/** Port of docx.ts renderBlock → PDF. Renders one block and returns. */
async function renderBlock(w: Writer, b: ContentBlock, images: Map<string, ResolvedImage>): Promise<boolean> {
  switch (b.block_type) {
    case "text": {
      const t = contentOf(b, "text", "");
      if (typeof t === "string" && t) await w.richText(t, images, b.block_id);
      return true;
    }
    case "heading": {
      const t = contentOf(b, "text", "");
      if (typeof t === "string" && t) await w.richText(t, images, b.block_id, { font: w.fonts.bold, size: 13 });
      return true;
    }
    case "equation": {
      const img = images.get(b.block_id);
      if (!img) {
        const latex = contentOf(b, "latex", "");
        if (typeof latex === "string" && latex) w.text(latex.replace(/\\(?:left|right)\b/g, "").replace(/\\(?:,|;|!|quad|qquad)/g, " "), { font: w.fonts.italic, size: 10, color: GRAY, align: contentOf(b, "display", true) !== false ? "center" : "left" });
        return true;
      }
      const embedded = await w.pdf.embedPng(img.data);
      w.fitImage(embedded, { maxW: 3 * PT, maxH: 0.32 * PT });
      return true;
    }
    case "image":
    case "diagram":
    case "graph": {
      const img = images.get(b.block_id);
      if (!img) {
        const path = contentOf(b, "asset_path", "");
        w.text(`[missing image: ${typeof path === "string" ? path : ""}]`, { font: w.fonts.italic, size: 10, color: GRAY });
        return true;
      }
      const embedded = img.mime === "image/jpeg" ? await w.pdf.embedJpg(img.data) : await w.pdf.embedPng(img.data);
      w.fitImage(embedded, { maxW: 4.5 * PT });
      return true;
    }
    case "table": {
      const cols = contentOf(b, "columns", []);
      const rows = contentOf(b, "rows", []);
      if (!Array.isArray(cols) || !Array.isArray(rows) || cols.length === 0) return true;
      const width = BODY_W;
      const widths = cols.map(() => width / cols.length);
      const header = cols.map((cell) => String(cell ?? ""));
      const inline = { images, blockId: b.block_id, index: { value: 0 } };
      await w.gridRow(header, widths, { font: w.fonts.bold, fill: HEADER_BG, align: "center", inline });
      for (const row of rows) {
        const cells = Array.isArray(row)
          ? (row as unknown[]).map((c) => (c == null ? "" : String(c)))
          : [];
        if (cells.length === 0) continue;
        await w.gridRow(cells.slice(0, cols.length), widths, { align: "center", inline });
      }
      return true;
    }
    case "list": {
      const items = contentOf(b, "items", []);
      const ordered = contentOf(b, "ordered", false) === true;
      if (Array.isArray(items)) {
        const mc = !ordered && items.length > 0 && items.every((it) => isMcOptionLine(String(it)));
        const mathIndex = { value: 0 };
        if (mc) {
          const optionLines = items.reduce(
            (sum, item) => sum + wrapText(w.fonts.reg, formatMcOption(String(item)), EXAM.font.bodyPt, BODY_W - 20).length,
            0
          );
          w.ensure(optionLines * LINE_H(EXAM.font.bodyPt));
        }
        for (let i = 0; i < items.length; i++) {
          const raw = String(items[i]);
          const item = mc ? formatMcOption(raw) : raw;
          const prefix = ordered ? `${i + 1}.` : mc ? "" : "•";
          await w.richText(`${prefix ? `${prefix}  ` : ""}${item}`, images, b.block_id, { indent: prefix ? 12 : 20, mathIndex });
        }
      }
      return true;
    }
    case "code": {
      const code = contentOf(b, "code", "");
      if (typeof code === "string") {
        for (const line of code.split("\n")) {
          for (const piece of wrapText(w.fonts.mono, line || " ", 9, BODY_W)) {
            w.textLine(piece, { font: w.fonts.mono, size: 9 });
          }
        }
      }
      return true;
    }
    case "answer_area": {
      const lines = typeof contentOf(b, "lines", 3) === "number" ? contentOf(b, "lines", 3) : 3;
      const h = (lines + 1) * 22;
      w.ensure(h);
      for (let i = 0; i < lines; i++) {
        w.page.page.drawLine({
          start: { x: MARGIN_L, y: thisY(w, i) },
          end: { x: MARGIN_L + BODY_W, y: thisY(w, i) },
          thickness: 0.75,
          color: BORDER,
        });
      }
      w.y -= h;
      return true;
    }
    case "page_break": {
      w.newPage();
      return true;
    }
    default:
      return true;
  }
}

function thisY(w: Writer, i: number) {
  return w.y - 6 - i * 22;
}

async function renderBlocks(w: Writer, blocks: ContentBlock[], ids: Map<string, ResolvedImage>) {
  for (const b of blocks) await renderBlock(w, b, ids);
}

async function renderQuestionBlocks(w: Writer, q: Question, ids: Map<string, ResolvedImage>, slots: Array<"body" | "answer" | "solution" | "marking_criteria">) {
  await renderBlocks(w, contentBlocks(q, slots), ids);
}

const SOURCE_LINE_PT = 8;

function drawSourceLine(w: Writer, source: Question["source"]) {
  const text = formatSourceBracket(source);
  if (!text) return;
  w.text(text, { font: w.fonts.italic, size: SOURCE_LINE_PT, color: GRAY });
}

async function renderPaperQuestion(w: Writer, q: Question, sharedImages?: Map<string, ResolvedImage>) {
  const questionBody = q.parts.length
    ? q.body.filter((block) => block.block_type !== "answer_area")
    : q.body;
  const blocks: ContentBlock[] = [...questionBody];
  for (const part of q.parts) blocks.push(...part.body);
  const ids = sharedImages ?? new Map<string, ResolvedImage>([
    ...(await resolveImages(blocks)),
    ...(await resolveEquations(blocks)),
  ]);
  await renderBlocks(w, questionBody, ids);
  if (q.mcq_options?.length) {
    const items = q.mcq_options.map((option, i) => {
      const label = String.fromCharCode(65 + i);
      const text = option.content.map((block) => String(block.content.text ?? block.content.latex ?? "")).join(" ");
      return `(${label}) ${text}`;
    });
    await renderBlocks(w, [{ block_id: `${q.question_id}-mcq-options`, slot: "body", position: 0, block_type: "list", content: { ordered: false, items } } as ContentBlock], ids);
  }
  for (const part of q.parts) {
    const label = part.part_label ? `(${part.part_label})` : "";
    const marks = marksLabel(part.marks);
    const head = [label, marks ? `[${marks}]` : ""].filter(Boolean).join("  ");
    if (head) w.text(head, { font: w.fonts.bold, indent: 22 });
    await renderBlocks(w, part.body, ids);
    if (isWrittenResponseType(q.type_key) && !part.body.some((block) => block.block_type === "answer_area")) {
      await renderBlocks(w, [{
        block_id: `${part.question_id}-generated-answer-area`,
        slot: "body",
        position: part.body.length,
        block_type: "answer_area",
        content: { lines: responseLinesForMarks(part.marks) },
      }], ids);
    }
  }
  drawSourceLine(w, q.source);
}

export interface PdfOptions {
  title: string;
  courseName: string;
  achievedMarks: number;
  sections: DocSection[];
  resolvedImages?: Map<string, ResolvedImage>;
}

async function writeHscCover(w: Writer, plan: ExamPaperPlan) {
  w.spacer(24);
  w.text(EXAM.certificateLine, { font: w.fonts.bold, size: EXAM.font.bodyPt, align: "center" });
  w.spacer(8);
  w.text(plan.subjectLine, { font: w.fonts.bold, size: EXAM.font.coverTitlePt, align: "center" });
  if (plan.paperTitle && plan.paperTitle !== plan.subjectLine) {
    w.text(plan.paperTitle, { font: w.fonts.reg, size: EXAM.font.bodyPt, align: "center" });
  }
  w.spacer(16);

  const idBoxTop = w.y;
  w.spacer(8);
  w.text("Centre Number", { size: EXAM.font.smallPt, indent: 12 });
  w.spacer(14);
  w.text("Student Number", { size: EXAM.font.smallPt, indent: 12 });
  w.finishBox(idBoxTop);
  w.spacer(12);

  const instrTop = w.y;
  w.spacer(8);
  for (const line of generalInstructionsLines(plan)) {
    if (line === "General Instructions") {
      w.text(line, { font: w.fonts.bold, size: EXAM.font.bodyPt, indent: 12 });
    } else if (line === "") {
      w.spacer(6);
    } else {
      w.text(line, { size: EXAM.font.bodyPt, indent: 12 });
    }
  }
  w.finishBox(instrTop);

  w.spacer(12);
  w.text("Examination structure", { font: w.fonts.bold, size: EXAM.font.bodyPt });
  w.spacer(6);
  for (const sec of plan.sections) {
    for (const line of sectionOverviewLines(sec)) {
      if (line === "") w.spacer(4);
      else w.text(line, { size: EXAM.font.bodyPt, indent: 12 });
    }
    w.spacer(8);
  }
  w.text(plan.examDate, { size: EXAM.font.smallPt, color: GRAY, align: "center" });
}

function writeSectionHeader(w: Writer, sec: ReturnType<typeof buildExamPaperPlan>["sections"][number]) {
  w.spacer(10);
  const opening = sectionOpeningLines(sec);
  for (const line of opening) {
    if (line === "") w.spacer(4);
    else if (line === sec.title) {
      w.text(line, { font: w.fonts.bold, size: EXAM.font.titlePt });
      w.rule();
    }
    else if (line.endsWith(" marks")) w.text(line, { font: w.fonts.bold, size: EXAM.font.bodyPt });
    else {
      w.text(line, { size: EXAM.font.bodyPt });
      if (line.startsWith("Allow about ")) w.rule();
    }
  }
  w.spacer(8);
}

export async function buildPdfPaper(options: PdfOptions): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const fonts = await embedUnicodeFonts(pdf);
  const w = new Writer(pdf, fonts);
  const plan = buildExamPaperPlan(options);
  const allBlocks = options.sections.flatMap((section) => section.questions.flatMap((q) => [
    ...q.body,
    ...(q.mcq_options?.length ? [{ block_id: `${q.question_id}-mcq-options`, slot: "body" as const, position: q.body.length, block_type: "list" as const, content: { ordered: false, items: q.mcq_options.map((option, i) => `(${String.fromCharCode(65 + i)}) ${option.content.map((b) => String(b.content.text ?? b.content.latex ?? "")).join(" ")}`) } }] : []),
    ...q.parts.flatMap((part) => part.body),
  ]));
  const sharedImages = options.resolvedImages ?? new Map<string, ResolvedImage>([
    ...(await resolveImages(allBlocks)),
    ...(await resolveEquations(allBlocks)),
  ]);
  await writeHscCover(w, plan);
  w.newPage();

  let qn = 0;
  let planIdx = 0;
  for (let si = 0; si < options.sections.length; si++) {
    const section = options.sections[si];
    if (!section.questions.length) continue;
    const secPlan = plan.sections[planIdx++];
    if (!secPlan) continue;
    if (planIdx > 1) w.newPage();
    writeSectionHeader(w, secPlan);

    for (const q of section.questions) {
      const intro = q.body.find((b) => b.block_type === "text" || b.block_type === "heading");
      const introText = intro ? contentOf(intro, "text", "") : "";
      const introLines = typeof introText === "string" && introText
        ? wrapText(w.fonts.reg, introText, EXAM.font.bodyPt, BODY_W).length
        : 1;
      w.ensure((introLines + 1) * LINE_H(EXAM.font.bodyPt) + 8);
      qn += 1;
      w.spacer(6);
      const markText = formatMarks(q.marks);
      const headerY = w.y;
      w.textLine(`Question ${qn}`, { font: w.fonts.bold, size: EXAM.font.bodyPt });
      w.drawMarks(markText, headerY);
      await renderPaperQuestion(w, q, sharedImages);
      if ((q.type_key ?? "").toLowerCase() !== "multiple_choice" && !(q.parts.length && isWrittenResponseType(q.type_key))) {
        const lineCount = Math.max(0, Math.floor((q.marks ?? 0) * 3 + 2));
        for (let i = 0; i < lineCount; i++) {
          w.ensure(LINE_H(EXAM.font.bodyPt));
          w.page.page.drawLine({ start: { x: MARGIN_L, y: w.y - 3 }, end: { x: MARGIN_L + BODY_W, y: w.y - 3 }, thickness: 0.45, color: HR });
          w.y -= LINE_H(EXAM.font.bodyPt);
        }
      }
      w.spacer(10);
    }
  }
  w.drawPageFooter();
  const bytes = await pdf.save();
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}

export async function buildPdfSolutions(options: PdfOptions): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const fonts = await embedUnicodeFonts(pdf);
  const w = new Writer(pdf, fonts);
  w.spacer(48);
  w.text(`Marking guidelines — ${options.title}`, { font: w.fonts.bold, size: EXAM.font.coverTitlePt, align: "center" });
  w.text(options.courseName, { size: EXAM.font.bodyPt, align: "center" });
  w.spacer(12);
  w.rule();
  w.newPage();

  let qn = 0;
  for (const section of options.sections) {
    if (section.label) {
      w.ensure(30);
      w.text(section.label, { font: w.fonts.bold, size: 13 });
      w.rule();
      w.spacer(6);
    }
    for (const q of section.questions) {
      qn += 1;
      w.ensure(40);
      w.rule();
      w.spacer(2);
      w.textLine(`Question ${qn}`, { font: w.fonts.bold, size: 12 });
      w.y -= 2;

      const criteria = criteriaRows(q.marking_criteria);
      if (criteria.hasRows) {
        w.text("Marking guide", { font: w.fonts.italic, size: 10, color: GRAY });
        for (const row of criteria.rows) {
          await w.gridRow([row.criteria, row.marks], [5 * PT, 1 * PT], { fill: HEADER_BG });
        }
        w.spacer(4);
      }
      if (criteria.supplementary.length) {
        const ids = options.resolvedImages ?? new Map<string, ResolvedImage>([
          ...(await resolveImages(q.marking_criteria)),
          ...(await resolveEquations(q.marking_criteria)),
        ]);
        await renderBlocks(w, criteria.supplementary, ids);
      }

      if (q.answer.length) {
        w.text("Answer", { font: w.fonts.italic, size: 10, color: GRAY });
        const ids = options.resolvedImages ?? new Map<string, ResolvedImage>([
          ...(await resolveImages(q.answer.concat(q.body))),
          ...(await resolveEquations(q.answer.concat(q.body))),
        ]);
        await renderQuestionBlocks(w, q, ids, ["answer"]);
      }
      if (q.solution.length) {
        w.text("Solution", { font: w.fonts.italic, size: 10, color: GRAY });
        const ids = options.resolvedImages ?? new Map<string, ResolvedImage>([
          ...(await resolveImages(q.solution.concat(q.body))),
          ...(await resolveEquations(q.solution.concat(q.body))),
        ]);
        await renderQuestionBlocks(w, q, ids, ["solution"]);
      }
      w.spacer(6);
    }
  }
  w.drawPageFooter();
  const bytes = await pdf.save();
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}
