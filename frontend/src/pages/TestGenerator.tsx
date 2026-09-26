import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, Eye, FileText, Plus, Printer, Trash2 } from "lucide-react";
import { api, type GeneratedTestMeta } from "../api/client";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { useCourseConfig } from "../hooks/useCourseConfig";
import { flattenCounts } from "../components/NodeTree";
import { Field, InkLoader, LoadingState, Meta, MiniRows, PageHeader, Panel, PanelHead } from "../components/system";
import { FilterMenu } from "../components/FilterMenu";
import { Button } from "../components/ui/button";
import { downloadTestFile, ensureTestFileUrl } from "../lib/tests";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { effectiveNodeFilterIds } from "../lib/nodeFilters";
import type { QuestionCountsResponse } from "../api/types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDurationClock(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins ? `${mins}m ${String(secs).padStart(2, "0")}s` : `${secs}s`;
}

interface SectionDraft {
  id: number;
  name: string;
  nodeIds: Set<string>;
  typeKeys: string[];
  difficulties: number[];
  institutionYears: Record<string, number[]>;
  marks: number;
}

export function TestGenerator() {
  const { courseId } = useActiveCourse();
  const { data: config } = useCourseConfig(courseId);
  const qc = useQueryClient();
  const nextId = useRef(2);

  const [sections, setSections] = useState<SectionDraft[]>([
    { id: 1, name: "", nodeIds: new Set(), typeKeys: [], difficulties: [], institutionYears: {}, marks: 20 },
  ]);
  const [format, setFormat] = useState<"docx" | "pdf">("docx");
  const [shuffle, setShuffle] = useState(true);
  const [title, setTitle] = useState("");

  const [generating, setGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [estimatedSeconds, setEstimatedSeconds] = useState(20);
  const [generationPhase, setGenerationPhase] = useState<"selecting" | "hydrating" | "paper" | "solutions" | "preview" | "saving">("selecting");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedTestMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!generating || startedAt == null) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [generating, startedAt]);

  const { data: counts } = useQuery({
    queryKey: ["question-counts", courseId],
    queryFn: () => api.questionCounts(courseId as string),
    enabled: !!courseId,
  });
  const flatCounts = useMemo(() => (counts ? flattenCounts(counts.by_node) : {}), [counts]);
  const { data: sourceOptions } = useQuery({ queryKey: ["question-source-options", courseId], queryFn: () => api.questionSourceOptions(courseId as string), enabled: !!courseId });

  const estimateSections = useMemo(() => sections.map((s) => ({
    node_ids: s.nodeIds.size ? effectiveNodeFilterIds(config?.nodes ?? [], s.nodeIds).sort() : undefined,
    type_keys: s.typeKeys.length ? [...s.typeKeys].sort() : undefined,
    difficulties: s.difficulties.length ? [...s.difficulties].sort((a, b) => a - b) : undefined,
    source_filters: Object.entries(s.institutionYears).map(([institution, years]) => ({ institution, years })),
    marks: s.marks,
  })), [sections, config?.nodes]);
  const { data: availability, isLoading: loadingAvailability } = useQuery({
    queryKey: ["test-availability", courseId, estimateSections],
    queryFn: () => api.estimateTestSections(courseId as string, estimateSections),
    enabled: !!courseId,
  });
  const sectionFacetQueries = useQueries({
    queries: sections.flatMap((section) => {
      const nodeIds = effectiveNodeFilterIds(config?.nodes ?? [], section.nodeIds).sort();
      const types = [...section.typeKeys].sort();
      const difficulties = [...section.difficulties].sort((a, b) => a - b);
      return [
        {
          queryKey: ["test-type-facet-counts", courseId, nodeIds, difficulties],
          queryFn: () => api.questionCounts(courseId as string, { node_ids: nodeIds, difficulties }),
          enabled: !!courseId,
        },
        {
          queryKey: ["test-difficulty-facet-counts", courseId, nodeIds, types],
          queryFn: () => api.questionCounts(courseId as string, {
            node_ids: nodeIds,
            type: types.length ? types : undefined,
          }),
          enabled: !!courseId,
        },
        {
          queryKey: ["test-source-facet-counts", courseId, nodeIds, types, difficulties],
          queryFn: () => api.questionSourceCounts(courseId as string, {
            node_ids: nodeIds, type: types, difficulties,
          }),
          enabled: !!courseId,
        },
      ];
    }),
  });

  const { data: pastTests, isLoading: loadingPastTests, refetch: refetchPastTests } = useQuery({
    queryKey: ["tests", courseId],
    queryFn: () => api.listTests(courseId as string),
    enabled: !!courseId,
  });

  const summary = useMemo(() => {
    return {
      marksRequested: sections.reduce((sum, s) => sum + s.marks, 0),
      availableQuestions: availability?.reduce((sum, s) => sum + s.question_count, 0) ?? 0,
      availableMarks: availability?.reduce((sum, s) => sum + s.available_marks, 0) ?? 0,
    };
  }, [sections, availability]);

  const allSectionsValid = sections.length > 0 && sections.every((s) => s.marks >= 5 && s.marks <= 80);

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
  const markMismatches = useMemo(
    () => result?.section_results?.filter(
      (section) => section.selection_limited || (section.marks_requested != null && Math.abs(section.marks - section.marks_requested) > 0.009)
    ) ?? [],
    [result]
  );

  function updateSection(id: number, patch: Partial<SectionDraft>) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function addSection() {
    setSections((prev) => [
      ...prev,
      { id: nextId.current++, name: "", nodeIds: new Set(), typeKeys: [], difficulties: [], institutionYears: {}, marks: 20 },
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
    const start = Date.now();
    setStartedAt(start);
    setElapsedSeconds(0);
    setGenerationPhase("selecting");
    const estimatedQuestionCount = sections.reduce((sum, section, index) => {
      const available = availability?.[index];
      const averageMarks = available && available.question_count > 0
        ? available.available_marks / available.question_count
        : 0;
      return sum + (averageMarks > 0 ? section.marks / averageMarks : 0);
    }, 0);
    const perQuestion = format === "pdf" ? 5 : 4;
    const initialEstimate = Math.max(20, Math.round(15 + estimatedQuestionCount * perQuestion));
    setEstimatedSeconds(initialEstimate);
    setError(null);
    setResult(null);
    try {
      const meta = await api.generateTest(courseId, {
        title: title.trim() || undefined,
        format,
        shuffle,
        selectionTimeoutMs: Math.ceil(initialEstimate * 1.25 * 1000),
        sections: sections.map((s) => ({
          name: s.name.trim() || undefined,
          node_ids: s.nodeIds.size ? effectiveNodeFilterIds(config?.nodes ?? [], s.nodeIds) : undefined,
          type_keys: s.typeKeys.length ? s.typeKeys : undefined,
          difficulties: s.difficulties.length ? s.difficulties : undefined,
          source_filters: Object.entries(s.institutionYears).map(([institution, years]) => ({ institution, years })),
          marks: s.marks,
        })),
        onProgress: (progress) => {
          setGenerationPhase(progress.phase);
          if (progress.questionCount != null && progress.phase !== "selecting") {
            // PDF generation lays out the paper and solutions separately; DOCX
            // also builds a PDF preview. Keep estimates conservative for those passes.
            const perQuestion = format === "pdf" ? 5 : 4;
            setEstimatedSeconds(Math.max(20, Math.round(15 + progress.questionCount * perQuestion)));
          }
        },
      });
      setResult(meta);
      refetchPastTests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate test");
    } finally {
      setGenerating(false);
      setStartedAt(null);
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
        description="Build a print-ready paper section by section. Set a marks target and tailored topic, type and difficulty filters for each section."
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
              <p className="self-center text-sm text-muted-foreground">Each section has its own topic, type and difficulty filters.</p>
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="2 · Build sections"
              note="Set the marks target and filters independently for each section."
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
                  <div className="grid items-end gap-3 sm:grid-cols-[28px_minmax(140px,1fr)_auto]">
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
                    <div className="w-64 max-w-full">
                      <Field label={`Section marks · ${sec.marks}`}>
                        <input aria-label={`Section ${index + 1} marks`} className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary" type="range" min={5} max={80} step={1} value={sec.marks} onChange={(e) => updateSection(sec.id, { marks: Number(e.target.value) })} />
                        <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground"><span>5</span><span>80 marks</span></div>
                      </Field>
                    </div>
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
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="label mb-2">Section filters</p>
                    <FilterMenu
                      inline
                      nodes={config?.nodes ?? []} counts={flatCounts} selectedNodes={sec.nodeIds}
                      onSelectedNodesChange={(nodeIds) => updateSection(sec.id, { nodeIds })}
                      onReset={() => updateSection(sec.id, { nodeIds: new Set(), typeKeys: [], difficulties: [], institutionYears: {} })}
                      questionTypes={config?.question_types ?? []} typeCounts={(sectionFacetQueries[index * 3]?.data as QuestionCountsResponse | undefined)?.by_type}
                      typeKeys={sec.typeKeys} onTypeKeysChange={(typeKeys) => updateSection(sec.id, { typeKeys })}
                      difficultyLevels={config?.difficulty_levels ?? []} difficultyCounts={(sectionFacetQueries[index * 3 + 1]?.data as QuestionCountsResponse | undefined)?.by_difficulty}
                      difficulties={sec.difficulties} onDifficultiesChange={(difficulties) => updateSection(sec.id, { difficulties })}
                      institutions={sourceOptions?.institutions} institutionCounts={sectionFacetQueries[index * 3 + 2]?.data as Record<string, { total: number; years: Record<string, number> }> | undefined} institutionYears={sec.institutionYears} onInstitutionYearsChange={(institutionYears) => updateSection(sec.id, { institutionYears })}
                    />
                    <span className="ml-2 text-xs text-muted-foreground">{sec.nodeIds.size || "All"} topics · {sec.typeKeys.length || "All"} types · {sec.difficulties.length || "All"} difficulties</span>
                    <p className="mt-2 text-sm font-medium" aria-live="polite">
                      Available: {loadingAvailability || !availability ? "Updating…" : `${availability[index]?.question_count ?? 0} questions · ${availability[index]?.available_marks ?? 0} marks`}
                    </p>
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
                {summary.marksRequested} marks requested · {loadingAvailability || !availability ? "Updating availability…" : `${summary.availableQuestions} available questions · ${summary.availableMarks} available marks`}
              </Meta>
              <Button disabled={generating || !allSectionsValid} onClick={handleGenerate}>
                <Printer />
                {generating ? "Generating…" : "Generate paper"}
              </Button>
            </div>
            {generating && (
              <div className="border-t border-border px-5 py-3">
                <InkLoader intervalMs={4000} messages={{
                  selecting: [
                    "Finding the closest mark combination…",
                    "Checking question marks against your target…",
                    "Comparing possible question combinations…",
                    "Choosing the best match for your requested marks…",
                  ],
                  hydrating: [
                    "Loading the selected questions…",
                    "Gathering question text and diagrams…",
                    "Collecting answer choices and mark details…",
                    "Preparing the selected questions for your paper…",
                  ],
                  paper: [
                    `Building the ${format.toUpperCase()} paper…`,
                    "Laying out questions and answer spaces…",
                    "Formatting headings, marks, and page breaks…",
                    "Rendering the paper pages…",
                  ],
                  solutions: [
                    `Building the ${format.toUpperCase()} solutions…`,
                    "Laying out worked solutions and marking points…",
                    "Formatting the answer key…",
                    "Rendering the solutions pages…",
                  ],
                  preview: [
                    "Preparing the in-app PDF preview…",
                    "Opening the generated paper preview…",
                    "Finishing the preview document…",
                  ],
                  saving: [
                    "Saving the generated files…",
                    "Writing the paper and solutions to your question bank…",
                    "Finishing up and saving your test…",
                  ],
                }[generationPhase]} />
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Elapsed {formatDurationClock(elapsedSeconds)} · Estimated total about {formatDurationClock(estimatedSeconds)}
                </p>
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
              {markMismatches.length > 0 && (
                <div className="mx-5 mt-4 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm" role="status">
                  {markMismatches.map((section, index) => (
                    <p key={`${section.name}-${index}`}>
                      {section.selection_limited
                        ? `${section.name}: the search reached its time limit, so it used the closest combination found so far (${section.marks} marks for a ${section.marks_requested}-mark target).`
                        : `${section.name}: the requested ${section.marks_requested} marks weren’t achievable exactly; the closest available total was ${section.marks} marks.`}
                    </p>
                  ))}
                </div>
              )}
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
