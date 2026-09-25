import type { ContentBlock, Source } from "../api/types";

export interface CriteriaRow {
  criteria: string;
  marks: string;
}

export const MARKS_PREFIX_RE =
  /^(\d+(?:\.\d+)?)\s*(?:(?:-\s*|–\s*|—\s*|\bto\b\s+|\bor\b\s+|\/\s*)(\d+(?:\.\d+)?))?\s*marks?\b/i;

export const MARKS_TRAIL_RE =
  /\s*[([](\d+(?:\.\d+)?(?:\s*[-\u2013\u2014/]\s*\d+(?:\.\d+)?)?)\s*marks?\s*[)]]\s*$/i;

function stripAllocationChars(s: string): string {
  return s.replace(/^[:–—:-]+/, "").trim();
}

/** Splits a marking-guide line into (allocation, clean text). */
export function splitAllocation(text: string): { allocation: string; clean: string } {
  const prefix = MARKS_PREFIX_RE.exec(text);
  if (prefix) {
    const low = prefix[1];
    const high = prefix[2];
    const allocation = high ? `${low}\u2013${high}` : low;
    const clean = stripAllocationChars(text.slice(prefix[0].length));
    return { allocation, clean };
  }
  const trail = MARKS_TRAIL_RE.exec(text);
  if (trail) {
    const group = trail[1].replace(/\s+/g, "");
    return { allocation: group, clean: text.slice(0, trail.index).trim() };
  }
  return { allocation: "", clean: text };
}

/**
 * Port of exam_export.py criteria_rows: list items and non-empty text blocks
 * become <criteria, alloc> rows; every other block type is supplementary.
 */
export function criteriaRows(
  marking: ContentBlock[]
): { rows: CriteriaRow[]; hasRows: boolean; supplementary: ContentBlock[] } {
  const sorted = [...marking].sort((a, b) => a.position - b.position);
  const rows: CriteriaRow[] = [];
  const supplementary: ContentBlock[] = [];
  for (const block of sorted) {
    if (block.block_type === "list") {
      const content = block.content ?? {};
      const items: unknown = content.items;
      if (Array.isArray(items)) {
        for (const item of items) {
          const text = String(item ?? "");
          const { allocation, clean } = splitAllocation(text);
          rows.push({ criteria: clean, marks: allocation });
        }
      }
      continue;
    }
    if (block.block_type === "text" && String(block.content?.text ?? "").trim()) {
      const text = String(block.content.text);
      const { allocation, clean } = splitAllocation(text);
      rows.push({ criteria: clean, marks: allocation });
      continue;
    }
    supplementary.push(block);
  }
  return { rows, hasRows: rows.length > 0, supplementary };
}

/** {marks:g} equivalent — integers print bare, floats trimmed. */
export function formatMarks(marks: number | null | undefined): string {
  if (marks === null || marks === undefined) return "";
  if (Number.isInteger(marks)) return String(marks);
  return String(Number(marks.toFixed(2)));
}

export function marksLabel(marks: number | null | undefined): string {
  const m = formatMarks(marks);
  if (!m) return "";
  return `${m} mark${marks === 1 ? "" : "s"}`;
}

/** Source attribution for generated test papers, e.g. "(Trial Examination, 2025)". */
export function formatSourceBracket(source: Source | null | undefined): string | null {
  if (!source?.name) return null;
  const inner = [source.name, source.year != null ? String(source.year) : null]
    .filter(Boolean)
    .join(", ");
  return `(${inner})`;
}

export function contentOf(block: ContentBlock, key: string, fallback: unknown = null): any {
  const c = block.content ?? {};
  const v = c[key];
  return v === undefined || v === null ? fallback : v;
}