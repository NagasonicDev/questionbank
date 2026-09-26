import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type ImportResponse } from "../api/client";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { useCourseConfig } from "../hooks/useCourseConfig";
import { PageHeader, Panel, PanelHead, Meta } from "../components/system";
import { Button } from "../components/ui/button";
import { Upload, FileJson } from "lucide-react";
import JSZip from "jszip";
import * as idb from "../lib/db/indexeddb";
import { newId } from "../lib/id";
import { ensureAssetUrl } from "../lib/assets";

async function parseQuestionBundle(file: File) {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(file);
  } catch {
    throw new Error("This is not a valid .qbx question bundle.");
  }
  const manifest = archive.file("questions.json");
  if (!manifest) throw new Error("This .qbx bundle has no questions.json file.");
  const payload = JSON.parse(await manifest.async("string"));
  if (payload.export_schema_version !== 1 || !Array.isArray(payload.questions)) {
    throw new Error("Unsupported or invalid .qbx question bundle.");
  }

  const blobs = new Map<string, Blob>();
  const folder = archive.folder("assets");
  if (folder) {
    for (const path in folder.files) {
      const entry = folder.files[path];
      if (entry.dir) continue;
      const filename = path.split("/").pop() ?? "";
      const assetId = filename.replace(/\.[^.]*$/, "");
      if (assetId) blobs.set(assetId, await entry.async("blob"));
    }
  }

  const assetMap = new Map<string, string>();
  const rewriteQuestion = (question: any) => {
    for (const asset of question.assets ?? []) {
      const oldId = String(asset.asset_id);
      if (blobs.has(oldId) && !assetMap.has(oldId)) assetMap.set(oldId, newId("asset"));
      const mapped = assetMap.get(oldId);
      if (mapped) {
        asset.asset_id = mapped;
        asset.file_path = mapped;
      }
    }
    const rewriteBlocks = (blocks: any[]) => {
      for (const block of blocks ?? []) {
        const oldId = block.content?.asset_path;
        if (typeof oldId === "string" && assetMap.has(oldId)) block.content.asset_path = assetMap.get(oldId);
      }
    };
    for (const slot of ["body", "answer", "solution", "marking_criteria"]) rewriteBlocks(question[slot]);
    for (const option of question.mcq_options ?? []) rewriteBlocks(option.content);
    for (const part of question.parts ?? []) rewriteQuestion(part);
  };
  for (const question of payload.questions) rewriteQuestion(question);

  for (const [oldId, newAssetId] of assetMap) {
    const blob = blobs.get(oldId);
    if (blob) await idb.putAsset(newAssetId, blob);
  }
  for (const id of assetMap.values()) await ensureAssetUrl(id);
  return { ...payload, questions: payload.questions };
}

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
      const parsed = file.name.toLowerCase().endsWith(".qbx")
        ? await parseQuestionBundle(file)
        : JSON.parse(await file.text());
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
        description="Import questions from an AI-generated JSON file or a question-only .qbx bundle."
      />

      <Panel>
        <PanelHead title="Question import" note={`Target course: ${config.name}`} />
        <ol className="grid gap-0 p-5 sm:grid-cols-2">
          <li className="border-b border-border pb-4 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-5">
            <Meta>JSON workflow · Step 01</Meta>
            <h3 className="mt-2 font-display text-lg font-semibold">Prepare with the course skill</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Download the skill file in Course Settings, then give it and your source document to an AI assistant to
              produce the import JSON.
            </p>
          </li>
          <li className="pt-4 sm:pl-5 sm:pt-0">
            <Meta>JSON workflow · Step 02</Meta>
            <h3 className="mt-2 font-display text-lg font-semibold">Upload the JSON output</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              JSON questions are validated independently. A .qbx bundle imports its editable question data and
              packaged images into this course.
            </p>
          </li>
        </ol>
      </Panel>

      <Panel className="p-6">
        <label className="grid min-h-48 cursor-pointer place-items-center rounded-lg border border-dashed border-border bg-surface/40 p-6 text-center">
          <input
            type="file"
            accept=".json,.qbx,application/json,application/zip"
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
              {fileName ? "Click to choose a different file." : "Choose the JSON from Step 01 or a .qbx question bundle."}
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
