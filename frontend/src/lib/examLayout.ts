import type { DocSection } from "./docx";

/** Two handwriting lines per mark, with at least one line for a marked part. */
export function responseLinesForMarks(marks: number | null | undefined): number {
  return Math.max(1, Math.ceil((marks ?? 0) * 2));
}

export function isWrittenResponseType(typeKey: string): boolean {
  return typeKey === "extended_response" || typeKey === "short_response" || typeKey === "short_answer";
}

/** Shared HSC-style examination paper layout (NESA conventions). */
export const EXAM = {
  /** A4 */
  page: { widthPt: 595.28, heightPt: 841.89 },
  margin: { top: 56.7, bottom: 62, left: 56.7, right: 56.7, marks: 32 },
  font: {
    family: "Times New Roman",
    bodyPt: 12,
    smallPt: 10,
    titlePt: 14,
    coverTitlePt: 16,
    lineHeight: 1.35,
  },
  /** ~1.8 min/mark for a 100-mark, 3-hour paper */
  minutesPerMark: 1.8,
  defaultReadingMinutes: 10,
  certificateLine: "HIGHER SCHOOL CERTIFICATE EXAMINATION",
} as const;

export interface ExamSectionPlan {
  /** Display title, e.g. "Section I" or a custom section name */
  title: string;
  marks: number;
  questionStart: number;
  questionEnd: number;
  minutesAllow: number;
  questionCount: number;
}

export interface ExamPaperPlan {
  subjectLine: string;
  paperTitle: string;
  totalMarks: number;
  totalQuestions: number;
  readingMinutes: number;
  workingMinutes: number;
  examDate: string;
  sections: ExamSectionPlan[];
}

function toRoman(n: number): string {
  const vals = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ] as const;
  let x = n;
  let out = "";
  for (const [v, s] of vals) {
    while (x >= v) {
      out += s;
      x -= v;
    }
  }
  return out || String(n);
}

export function defaultSectionTitle(index: number, custom: string | null): string {
  if (custom?.trim()) return custom.trim();
  return `Section ${toRoman(index + 1)}`;
}

/** Round section working time to a sensible whole number of minutes. */
export function minutesForMarks(marks: number): number {
  if (marks <= 0) return 0;
  const raw = marks * EXAM.minutesPerMark;
  if (raw < 15) return Math.max(5, Math.round(raw / 5) * 5);
  return Math.round(raw / 5) * 5;
}

export function formatDurationMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} minutes`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  const hourPart = h === 1 ? "1 hour" : `${h} hours`;
  return `${hourPart} and ${m} minutes`;
}

export function formatPageNumber(page: number): string {
  return `– ${page} –`;
}

export function formatQuestionRange(start: number, end: number): string {
  if (start === end) return `Question ${start}`;
  return `Questions ${start}–${end}`;
}

export function buildExamPaperPlan(opts: {
  title: string;
  courseName: string;
  achievedMarks: number;
  sections: DocSection[];
  examDate?: Date;
}): ExamPaperPlan {
  const examDate =
    opts.examDate ??
    new Date();
  const dateStr = examDate.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const sections: ExamSectionPlan[] = [];
  let qn = 0;
  for (let i = 0; i < opts.sections.length; i++) {
    const sec = opts.sections[i];
    const count = sec.questions.length;
    if (count === 0) continue;
    const start = qn + 1;
    qn += count;
    const end = qn;
    const marks = sec.questions.reduce((s, q) => s + (q.marks ?? 0), 0);
    sections.push({
      title: defaultSectionTitle(i, sec.label),
      marks: Math.round(marks * 100) / 100,
      questionStart: start,
      questionEnd: end,
      questionCount: count,
      minutesAllow: minutesForMarks(marks),
    });
  }

  const totalQuestions = qn;
  const totalMarks = opts.achievedMarks;
  const workingMinutes = minutesForMarks(totalMarks);

  return {
    subjectLine: opts.courseName,
    paperTitle: opts.title,
    totalMarks,
    totalQuestions,
    readingMinutes: EXAM.defaultReadingMinutes,
    workingMinutes,
    examDate: dateStr,
    sections,
  };
}

export function generalInstructionsLines(plan: ExamPaperPlan): string[] {
  return [
    "General Instructions",
    "",
    `Reading time – ${plan.readingMinutes} minutes`,
    `Working time – ${formatDurationMinutes(plan.workingMinutes)}`,
    "Write using black pen",
    "Draw diagrams using pencil",
    "Approved calculators may be used unless stated otherwise",
    `Total marks – ${plan.totalMarks}`,
  ];
}

export function sectionOverviewLines(sec: ExamSectionPlan): string[] {
  const lines = [
    `${sec.title} – ${sec.marks} marks`,
    "",
    `Attempt ${formatQuestionRange(sec.questionStart, sec.questionEnd)}`,
    `Allow about ${formatDurationMinutes(sec.minutesAllow)} for this section`,
  ];
  return lines;
}

export function sectionOpeningLines(sec: ExamSectionPlan): string[] {
  return [
    sec.title,
    `${sec.marks} marks`,
    "",
    `Attempt ${formatQuestionRange(sec.questionStart, sec.questionEnd)}`,
    `Allow about ${formatDurationMinutes(sec.minutesAllow)} for this section`,
  ];
}

/** Detect multiple-choice option lines like "(A) …" for HSC-style lettering. */
export function isMcOptionLine(text: string): boolean {
  return /^\([A-Da-d]\)\s/.test(text.trim());
}

export function formatMcOption(text: string): string {
  const t = text.trim();
  const m = t.match(/^\(([A-Da-d])\)\s*(.*)$/);
  if (!m) return t;
  return `${m[1].toUpperCase()}. ${m[2]}`;
}
