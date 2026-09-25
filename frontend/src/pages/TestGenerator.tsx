import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, Eye, FileText, Plus, Printer, Trash2 } from "lucide-react";
import { api, type GeneratedTestMeta } from "../api/client";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { useCourseConfig } from "../hooks/useCourseConfig";
import { flattenCounts } from "../components/NodeTree";
import { Field, LoadingState, Meta, MiniRows, PageHeader, Panel, PanelHead } from "../components/system";
import { FilterMenu } from "../components/FilterMenu";
import { Button } from "../components/ui/button";
import { downloadTestFile, ensureTestFileUrl } from "../lib/tests";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface SectionDraft {
  id: number;
  name: string;
  typeKey: string; // "" = any type
  mode: "count" | "marks";
  count: number;
  marks: number;
}

export function TestGenerator() {
  const { courseId } = useActiveCourse();
  const { data: config } = useCourseConfig(courseId);
  const qc = useQueryClient();
  const nextId = useRef(2);

  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [typeKeys, setTypeKeys] = useState<string[]>([]);
  const [difficulties, setDifficulties] = useState<number[]>([]);
  const [sections, setSections] = useState<SectionDraft[]>([
    { id: 1, name: "", typeKey: "", mode: "count", count: 10, marks: 10 },
  ]);
  const [format, setFormat] = useState<"docx" | "pdf">("docx");
  const [shuffle, setShuffle] = useState(true);
  const [title, setTitle] = useState("");

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedTestMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: counts } = useQuery({
    queryKey: ["question-counts", courseId],
    queryFn: () => api.questionCounts(courseId as string),
    enabled: !!courseId,
  });
  const flatCounts = useMemo(() => (counts ? flattenCounts(counts.by_node) : {}), [counts]);

  const { data: pastTests, isLoading: loadingPastTests, refetch: refetchPastTests } = useQuery({
    queryKey: ["tests", courseId],
    queryFn: () => api.listTests(courseId as string),
    enabled: !!courseId,
  });

  const summary = useMemo(() => {
    const questionsRequested = sections
      .filter((s) => s.mode === "count")
      .reduce((sum, s) => sum + Math.max(0, s.count), 0);
    const marksRequested = sections
      .filter((s) => s.mode === "marks")
      .reduce((sum, s) => sum + Math.max(0, s.marks), 0);
    return { questionsRequested, marksRequested };
  }, [sections]);

  const allSectionsValid =
    sections.length > 0 &&
    sections.every((s) => (s.mode === "count" ? s.count >= 1 : s.marks > 0));

  const levelLabels = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of config?.difficulty_levels ?? []) m.set(d.level, d.label);
    return m;
  }, [config]);

  const scopeText = `${config?.hierarchy[0]?.label ?? "Topics"}: ${
    selectedNodes.size ? `${selectedNodes.size} selected` : "all"
  } · Difficulties: ${
    difficulties.length
      ? difficulties.map((d) => levelLabels.get(d) ?? String(d)).join(", ")
      : "all"
  } · Types: ${typeKeys.length ? typeKeys.map((t) => t.replace(/_/g, " ")).join(", ") : "all"}`;

  useEffect(() => {
    if (!result) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    void ensureTestFileUrl(result.test_id, "preview").then((url) => {
      if (!cancelled) setPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [result?.test_id]);

  async function handleDownload(test: GeneratedTestMeta, which: "test" | "solutions") {
    setDownloadError(null);
    setDownloading(`${test.test_id}:${which}`);
    try {
      await downloadTestFile(test.test_id, which, test.format as "docx" | "pdf");
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }

  const sectionRows = useMemo(() => {
    if (result?.section_results && result.section_results.length > 0) {
      return [
        ...result.section_results.map(
          (sec) => [sec.name, `${sec.question_count} · ${sec.marks}`] as [string, string]
        ),
        ["Total", `${result.question_count} · ${result.achieved_marks}`],
      ] as Array<[string, string]>;
    }
    return [
      ["Questions", String(result?.question_count ?? 0)],
      ["Marks", String(result?.achieved_marks ?? 0)],
    ] as Array<[string, string]>;
  }, [result]);

  function handleReset() {
    setSelectedNodes(new Set());
    setTypeKeys([]);
    setDifficulties([]);
  }

  function updateSection(id: number, patch: Partial<SectionDraft>) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function addSection() {
    setSections((prev) => [
      ...prev,
      { id: nextId.current++, name: "", typeKey: "", mode: "count", count: 10, marks: 10 },
    ]);
  }
  function removeSection(id: number) {
    setSections((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  }
  function moveSection(id: number, dir: -1 | 1) {
    setSections((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function handleGenerate() {
    if (!courseId) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const meta = await api.generateTest(courseId, {
        title: title.trim() || undefined,
        node_ids: selectedNodes.size ? Array.from(selectedNodes) : undefined,
        format,
        shuffle,
        sections: sections.map((s) => ({
          name: s.name.trim() || undefined,
          node_ids: selectedNodes.size ? Array.from(selectedNodes) : undefined,
          type_key: s.typeKey || undefined,
          type_keys: s.typeKey ? undefined : (typeKeys.length ? typeKeys : undefined),
          difficulties: difficulties.length ? difficulties : undefined,
          count: s.mode === "count" ? s.count : undefined,
          marks: s.mode === "marks" ? s.marks : undefined,
        })),
      });
      setResult(meta);
      refetchPastTests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate test");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteTest(testId: string) {
    if (!window.confirm("Delete this generated test and its files? This can't be undone.")) return;
    await api.deleteTest(testId);
    if (result?.test_id === testId) setResult(null);
    qc.invalidateQueries({ queryKey: ["tests", courseId] });
  }

  if (!courseId) {
    return <p className="text-sm text-muted-foreground">Select a course to generate a test.</p>;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Assessment design"
        title="Test Generator"
        description="Build a test paper section by section — each section picks its own question type and either a number of questions or a marks target. The result is a print-ready paper plus a separate solutions document."
        actions={
          <FilterMenu
            nodes={config?.nodes ?? []}
            counts={flatCounts}
            selectedNodes={selectedNodes}
            onSelectedNodesChange={setSelectedNodes}
            onReset={handleReset}
            questionTypes={config?.question_types ?? []}
            typeCounts={counts?.by_type}
            typeKeys={typeKeys}
            onTypeKeysChange={setTypeKeys}
            difficultyLevels={config?.difficulty_levels ?? []}
            difficultyCounts={counts?.by_difficulty}
            difficulties={difficulties}
            onDifficultiesChange={setDifficulties}
            hint="Selected topics, difficulty and question type apply to every section. A section that picks its own question type still wins over the default."
          />
        }
      />

      <div className="min-w-0 space-y-5">
        <Panel>
          <PanelHead title="1 · Paper details" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Optional test title">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`${config?.name ?? "Course"} — Practice Test`}
                />
              </Field>
              <div>
                <p className="label">Current scope</p>
                <p className="mt-1.5 text-sm text-muted-foreground">{scopeText}</p>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="2 · Build sections"
              note="Questions are picked independently for each section."
              action={
                <Button size="sm" onClick={addSection}>
                  <Plus />
                  Add section
                </Button>
              }
            />
            <div className="space-y-3 p-5">
              {sections.map((sec, index) => (
                <div key={sec.id} className="rounded-lg border border-border bg-surface/50 p-4">
                  <div className="grid items-end gap-3 lg:grid-cols-[28px_minmax(140px,1fr)_160px_150px_80px_auto]">
                    <span className="self-center font-mono text-xs text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <Field label="Name">
                      <Input
                        value={sec.name}
                        onChange={(e) => updateSection(sec.id, { name: e.target.value })}
                        placeholder="Section I (optional)"
                      />
                    </Field>
                    <Field label="Question type">
                      <Select
                        value={sec.typeKey || "all"}
                        onValueChange={(v) => updateSection(sec.id, { typeKey: v === "all" ? "" : v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Any type</SelectItem>
                          {(config?.question_types ?? []).map((t) => (
                            <SelectItem key={t} value={t}>
                              {t.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Selection">
                      <Select
                        value={sec.mode}
                        onValueChange={(v) => updateSection(sec.id, { mode: v as "count" | "marks" })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="count">Question count</SelectItem>
                          <SelectItem value="marks">Marks target</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={sec.mode === "count" ? "How many" : "Total marks"}>
                      <Input
                        type="number"
                        min={1}
                        step={sec.mode === "count" ? 1 : 0.5}
                        value={sec.mode === "count" ? sec.count : sec.marks}
                        onChange={(e) =>
                          updateSection(sec.id, sec.mode === "count"
                            ? { count: Number(e.target.value) }
                            : { marks: Number(e.target.value) })
                        }
                      />
                    </Field>
                    <div className="flex items-center gap-1 pb-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() => moveSection(sec.id, -1)}
                        title="Move up"
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={index === sections.length - 1}
                        onClick={() => moveSection(sec.id, 1)}
                        title="Move down"
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={sections.length === 1}
                        onClick={() => removeSection(sec.id)}
                        title="Remove section"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHead title="3 · Output options" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Output format">
                <Select value={format} onValueChange={(v) => setFormat(v as "docx" | "pdf")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="docx">Word document (.docx)</SelectItem>
                    <SelectItem value="pdf">PDF document</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Question ordering">
                <Select value={shuffle ? "random" : "sequential"} onValueChange={(v) => setShuffle(v === "random")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="random">Random selection</SelectItem>
                    <SelectItem value="sequential">Sequential (oldest first)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
              <Meta>
                {sections.length} section{sections.length === 1 ? "" : "s"} ·{" "}
                {summary.questionsRequested} question{summary.questionsRequested === 1 ? "" : "s"} requested ·{" "}
                {summary.marksRequested} marks requested.
              </Meta>
              <Button disabled={generating || !allSectionsValid} onClick={handleGenerate}>
                <Printer />
                {generating ? "Generating…" : "Generate paper"}
              </Button>
            </div>
            {generating && (
              <div className="border-t border-border px-5 py-3">
                <LoadingState label="Selecting questions and preparing your paper…" />
              </div>
            )}
          </Panel>

          {(error || downloadError) && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error ?? downloadError}
            </div>
          )}

          {result && (
            <Panel>
              <PanelHead
                title="Generated paper"
                note={`${result.question_count} questions · ${result.achieved_marks} marks`}
                action={
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" disabled={!!downloading} onClick={() => handleDownload(result, "test")}>
                      <Download />
                      {downloading === `${result.test_id}:test` ? "Downloading…" : "Paper"}
                    </Button>
                    <Button size="sm" disabled={!!downloading} onClick={() => handleDownload(result, "solutions")}>
                      <Download />
                      {downloading === `${result.test_id}:solutions` ? "Downloading…" : "Solutions"}
                    </Button>
                  </div>
                }
              />
              <div className="grid gap-4 p-5 xl:grid-cols-[220px_1fr]">
                <div>
                  <p className="label">Actual selection</p>
                  <div className="mt-2">
                    <MiniRows rows={sectionRows} />
                  </div>
                </div>
                <div className="paper-preview">
                  <div className="border-b-2 border-foreground pb-3 text-center">
                    <p className="font-display text-lg font-semibold">{result.title}</p>
                    <p className="font-mono text-[9px] uppercase">
                      {result.question_count} questions · {result.achieved_marks} marks
                    </p>
                  </div>
                  <div className="mt-4 text-xs leading-5">
                    <p>A preview of the generated test paper appears below.</p>
                    <p className="text-muted-foreground">
                      The solutions document isn't previewed here — download it separately.
                    </p>
                    {previewUrl ? (
                      <iframe
                        src={previewUrl}
                        title="Test preview"
                        className="mt-3 w-full rounded-md border border-border"
                        style={{ height: "60vh" }}
                      />
                    ) : (
                      <div className="mt-3 rounded-md border border-border bg-background/40 p-6">
                        <LoadingState label="Loading preview…" />
                        <p className="mt-2 text-center text-xs text-muted-foreground">
                          If it stays blank, use Download paper — the PDF may no longer be stored in this browser.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          )}

          <Panel>
            <PanelHead title="Past tests" note="Previously generated for this course" />
            {loadingPastTests ? (
              <div className="px-5 py-8"><LoadingState label="Loading past tests…" /></div>
            ) : !pastTests || pastTests.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                No tests generated yet for this course.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {pastTests.map((t) => (
                  <div key={t.test_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <Meta>
                        {formatDate(t.created_at)} · {t.question_count} questions · {t.achieved_marks} marks ·{" "}
                        {t.format.toUpperCase()}
                      </Meta>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" title="Preview" onClick={() => setResult(t)}>
                        <Eye />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Paper"
                        disabled={!!downloading}
                        onClick={() => handleDownload(t, "test")}
                      >
                        <FileText />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Solutions"
                        disabled={!!downloading}
                        onClick={() => handleDownload(t, "solutions")}
                      >
                        <Download />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Delete"
                        onClick={() => handleDeleteTest(t.test_id)}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
    </div>
  );
}
