import type { TestFile } from "./db/indexeddb";
import * as idb from "./db/indexeddb";
import type { Question } from "../api/types";
import type { TestSectionResult } from "../api/types";
import { buildDocxPaper, buildDocxSolutions, collectImages, type DocSection } from "./docx";
import { buildPdfPaper, buildPdfSolutions } from "./pdf";

const urlCache = new Map<string, string>();

function key(testId: string, which: TestFile): string {
  return `${testId}:${which}`;
}

function revokeUrl(testId: string, which: TestFile): void {
  const url = urlCache.get(key(testId, which));
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(key(testId, which));
  }
}

/** Store the three generated outputs and register fresh object URLs. */
export async function storeTestFiles(
  testId: string,
  files: Record<TestFile, Blob>
): Promise<void> {
  for (const which of ["test", "solutions", "preview"] as const) revokeUrl(testId, which);
  await idb.putTestFile(testId, "test", files.test);
  await idb.putTestFile(testId, "solutions", files.solutions);
  await idb.putTestFile(testId, "preview", files.preview);
  // Register URLs from the blobs we already have. Reading them back from
  // IndexedDB immediately after writing can race the transaction commit and
  // yield empty download/preview links.
  for (const which of ["test", "solutions", "preview"] as const) {
    urlCache.set(key(testId, which), URL.createObjectURL(files[which]));
  }
}

/** Resolve a file to an object URL, loading from IndexedDB if not registered yet. */
export async function ensureTestFileUrl(testId: string, which: TestFile): Promise<string | null> {
  const cached = urlCache.get(key(testId, which));
  if (cached) return cached;
  const blob = await idb.getTestFile(testId, which);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key(testId, which), url);
  return url;
}

export function testFileUrlSync(testId: string, which: TestFile): string | null {
  return urlCache.get(key(testId, which)) ?? null;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download a stored test paper or solutions file with a sensible filename. */
export async function downloadTestFile(
  testId: string,
  which: "test" | "solutions",
  format: "docx" | "pdf"
): Promise<void> {
  const blob = await idb.getTestFile(testId, which);
  if (!blob?.size) {
    throw new Error("That file is no longer available in this browser. Generate the test again.");
  }
  const ext = format === "pdf" ? "pdf" : "docx";
  const filename = which === "test" ? `test-paper.${ext}` : `solutions.${ext}`;
  triggerDownload(blob, filename);
}

/** Remove a test's files from IndexedDB and revoke its object URLs. */
export async function deleteTestOutputs(testId: string): Promise<void> {
  for (const which of ["test", "solutions", "preview"] as const) revokeUrl(testId, which);
  await idb.deleteTestFiles(testId);
}

export interface BuildOptions {
  testId: string;
  title: string;
  courseName: string;
  format: "docx" | "pdf";
  questions: Question[];
  sectionResults: TestSectionResult[];
  achievedMarks: number;
  sections: DocSection[];
  onProgress?: (progress: { phase: "selecting" | "paper" | "solutions" | "preview" | "saving"; questionCount?: number }) => void;
}

/**
 * Builds the paper, solutions, and preview for a generated test. Paper and
 * solutions use the same builder family (docx or pdf per the chosen format)
 * while the preview is always a PDF (the paper itself when format is pdf).
 */
export async function buildTestOutputs(options: BuildOptions): Promise<Record<TestFile, Blob>> {
  const { title, courseName, format, sections, achievedMarks } = options;
  const resolvedImages = await collectImages(sections);
  const docOptions = { title, courseName, achievedMarks, sections, resolvedImages };
  options.onProgress?.({ phase: "paper", questionCount: options.questions.length });
  const test =
    format === "pdf" ? await buildPdfPaper(docOptions) : await buildDocxPaper(docOptions);
  options.onProgress?.({ phase: "solutions", questionCount: options.questions.length });
  const solutions =
    format === "pdf"
      ? await buildPdfSolutions(docOptions)
      : await buildDocxSolutions(docOptions);
  let preview = test;
  if (format !== "pdf") {
    options.onProgress?.({ phase: "preview", questionCount: options.questions.length });
    preview = await buildPdfPaper(docOptions);
  }
  return { test, solutions, preview };
}
