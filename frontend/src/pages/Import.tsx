import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type ImportResponse } from "../api/client";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { useCourseConfig } from "../hooks/useCourseConfig";
import { PageHeader, Panel, PanelHead, Meta } from "../components/system";
import { Button } from "../components/ui/button";
import { Upload, FileJson } from "lucide-react";

export function Import() {
  const { courseId } = useActiveCourse();
  const { data: config } = useCourseConfig(courseId);
  const qc = useQueryClient();

  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  async function handleFile(file: File | null) {
    if (!file || !courseId) return;
    setFileName(file.name);
    setError(null);
    setResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await api.importJson(courseId, parsed);
      setResult(res);
      if (res.imported_count > 0) {
        qc.invalidateQueries({ queryKey: ["questions", courseId] });
        qc.invalidateQueries({ queryKey: ["question-counts", courseId] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed — check the file is valid JSON in the expected format");
    } finally {
      setImporting(false);
    }
  }

  if (!courseId || !config) {
    return <p className="text-sm text-muted-foreground">Select a course to import questions into.</p>;
  }

  const detailItems = result?.results.filter((r) => r.status === "error" || r.warnings.length > 0) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        eyebrow="Bulk intake"
        title="Import questions"
        description="Bring validated question sets into this course from an AI-generated JSON file."
      />

      <Panel>
        <PanelHead title="Two-step workflow" note={`Target course: ${config.name}`} />
        <ol className="grid gap-0 p-5 sm:grid-cols-2">
          <li className="border-b border-border pb-4 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-5">
            <Meta>Step 01</Meta>
            <h3 className="mt-2 font-display text-lg font-semibold">Prepare with the course skill</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Download the skill file in Course Settings, then give it and your source document to an AI assistant to
              produce the import JSON.
            </p>
          </li>
          <li className="pt-4 sm:pl-5 sm:pt-0">
            <Meta>Step 02</Meta>
            <h3 className="mt-2 font-display text-lg font-semibold">Upload the JSON output</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Every question is validated independently; rejections are reported inline so good questions are never
              blocked.
            </p>
          </li>
        </ol>
      </Panel>

      <Panel className="p-6">
        <label className="grid min-h-48 cursor-pointer place-items-center rounded-lg border border-dashed border-border bg-surface/40 p-6 text-center">
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            disabled={importing}
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <div>
            <Upload className="mx-auto mb-3 size-7 text-accent-foreground" />
            {importing ? (
              <h2 className="font-display text-xl font-semibold">Importing…</h2>
            ) : fileName ? (
              <h2 className="font-display text-xl font-semibold">{fileName}</h2>
            ) : (
              <h2 className="font-display text-xl font-semibold">Choose a JSON file</h2>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {fileName ? "Click to choose a different file." : "The file produced by Step 01."}
            </p>
            <Button className="mt-4" asChild>
              <span>
                <FileJson />
                Browse files
              </span>
            </Button>
          </div>
        </label>
      </Panel>

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {result && (
        <Panel>
          <PanelHead title="Import summary" note={`Job ${result.import_job_id ?? ""}`} />
          <div className="grid grid-cols-2 border-b border-border text-center">
            <div className="col-span-1 p-5">
              <Meta>Imported</Meta>
              <p className="mt-1 font-display text-4xl font-semibold text-success">{result.imported_count}</p>
            </div>
            <div className="border-l border-border p-5">
              <Meta>Rejected</Meta>
              <p className="mt-1 font-display text-4xl font-semibold text-destructive">{result.error_count}</p>
            </div>
            <div className="p-5 text-xs text-muted-foreground sm:col-span-2">
              {result.imported_count} question(s) imported
              {result.error_count > 0 ? `, ${result.error_count} rejected` : " without issues"}.
            </div>
          </div>

          {result.warnings.length > 0 && (
            <div className="space-y-1 border-b border-border bg-accent/30 px-5 py-4 text-sm text-accent-foreground">
              {result.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}

          {detailItems.length > 0 && (
            <div className="divide-y divide-border">
              {detailItems.map((r) => (
                <div key={r.index} className="grid gap-1 px-5 py-4 sm:grid-cols-[130px_90px_1fr]">
                  <span className="font-mono text-xs text-muted-foreground">Q{r.index + 1}</span>
                  <Meta className={r.status === "error" ? "text-destructive" : "text-accent-foreground"}>
                    {r.status === "error" ? "Rejected" : "Warnings"}
                  </Meta>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {r.errors.map((e, i) => (
                      <p key={i} className="text-destructive">{e}</p>
                    ))}
                    {r.warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      <p className="pt-2 text-xs text-muted-foreground">
        Prefer to add questions one at a time? Use <strong>Course Settings → Questions → Add question</strong>.
      </p>
    </div>
  );
}