import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shuffle, RefreshCw, Check, Eye } from "lucide-react";
import { api } from "../api/client";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { useCourseConfig } from "../hooks/useCourseConfig";
import { flattenCounts } from "../components/NodeTree";
import { QuestionSurface } from "../components/QuestionReader";
import type { Question } from "../api/types";
import { InkLoader, PageHeader, Panel } from "../components/system";
import { FilterMenu } from "../components/FilterMenu";
import { Button } from "../components/ui/button";
import { effectiveNodeFilterIds } from "../lib/nodeFilters";
import { useQuestionFilterCounts } from "../hooks/useQuestionFilterCounts";

export function Practice() {
  const { courseId } = useActiveCourse();
  const { data: config } = useCourseConfig(courseId);

  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [typeKeys, setTypeKeys] = useState<string[]>([]);
  const [difficulties, setDifficulties] = useState<number[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [institutionYears, setInstitutionYears] = useState<Record<string, number[]>>({});
  const { data: sourceOptions } = useQuery({ queryKey: ["question-source-options", courseId], queryFn: () => api.questionSourceOptions(courseId as string), enabled: !!courseId });
  const [avoidRecentDays, setAvoidRecentDays] = useState<number | null>(null);
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [current, setCurrent] = useState<Question | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: counts } = useQuery({
    queryKey: ["question-counts", courseId],
    queryFn: () => api.questionCounts(courseId as string),
    enabled: !!courseId,
  });
  const flatCounts = useMemo(() => (counts ? flattenCounts(counts.by_node) : {}), [counts]);

  const selectedNodeIds = useMemo(
    () => effectiveNodeFilterIds(config?.nodes ?? [], selectedNodes),
    [config?.nodes, selectedNodes]
  );
  const facetCounts = useQuestionFilterCounts(
    courseId, config?.nodes ?? [], selectedNodes, typeKeys, difficulties
  );
  const sourceFacetQuery = useQuery({
    queryKey: ["question-source-facet-counts", courseId, selectedNodeIds, typeKeys, difficulties, selectedTag],
    queryFn: () => api.questionSourceCounts(courseId as string, {
      node_ids: selectedNodeIds, type: typeKeys, difficulties, tag: selectedTag || undefined,
    }),
    enabled: !!courseId,
  });

  const { data: filteredQuestions } = useQuery({
    queryKey: ["practice-matching-count", courseId, selectedNodeIds, typeKeys, difficulties, selectedTag, institutionYears],
    queryFn: () => api.listQuestions(courseId as string, {
      node_id: selectedNodeIds.length ? selectedNodeIds : undefined,
      type: typeKeys.length ? typeKeys : undefined,
      difficulty: difficulties.length ? difficulties : undefined,
      tag: selectedTag || undefined,
      source_filters: Object.entries(institutionYears).map(([institution, years]) => ({ institution, years })),
      page_size: 1,
    }),
    enabled: !!courseId,
  });
  const matchingCount = filteredQuestions?.total ?? counts?.total ?? 0;

  function handleReset() {
    setSelectedNodes(new Set());
    setTypeKeys([]);
    setDifficulties([]);
    setSelectedTag("");
    setInstitutionYears({});
    setAvoidRecentDays(null);
  }

  async function getRandomQuestion(excludeCurrent: boolean) {
    if (!courseId) return;
    setLoading(true);
    setError(null);
    setSubmitted(false);
    setSelectedChoice(null);
    try {
      const exclude = excludeCurrent && current ? [...seenIds, current.question_id] : seenIds;
      const res = await api.randomQuestion({
        course_id: courseId,
        node_id: selectedNodeIds.length ? selectedNodeIds : undefined,
        type: typeKeys.length ? typeKeys : undefined,
        difficulty: difficulties.length ? difficulties : undefined,
        tag: selectedTag || undefined,
        source_filters: Object.entries(institutionYears).map(([institution, years]) => ({ institution, years })),
        exclude_question_ids: exclude.length ? exclude : undefined,
        exclude_recent_days: avoidRecentDays ?? undefined,
      });
      if (res.question) {
        setCurrent(res.question);
        setSelectedChoice(null);
        setSeenIds((prev) => [...prev, res.question!.question_id].slice(-50));
        // Fire-and-forget: log this as "seen" so it shows up in the Recent
        // Questions sidebar even if the person never hits Submit.
        api.recordAttempt({ question_id: res.question.question_id, status: "seen" }).catch(() => {});
      } else {
        setCurrent(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch a question");
    } finally {
      setLoading(false);
    }
  }

  if (!courseId) {
    return <p className="text-sm text-muted-foreground">Select a course to start practising.</p>;
  }

  function handleSubmit() {
    if (!current) return;
    if (!submitted) {
      api.recordAttempt({ question_id: current.question_id, status: "completed" }).catch(() => {});
    }
    setSubmitted(true);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Focused practice"
        title="Practice"
        description="Draw a random question that matches your filters, answer it, then self-assess against the marking guide."
        actions={
          <>
            <div className="rounded-md bg-secondary px-3 py-2 font-mono text-xs">
              <strong>{matchingCount ?? counts?.total ?? 0}</strong> matches
            </div>
            <FilterMenu
              nodes={config?.nodes ?? []}
              counts={flatCounts}
              selectedNodes={selectedNodes}
              onSelectedNodesChange={setSelectedNodes}
              onReset={handleReset}
              questionTypes={config?.question_types ?? []}
              typeCounts={facetCounts.typeCounts}
              typeKeys={typeKeys}
              onTypeKeysChange={setTypeKeys}
              difficultyLevels={config?.difficulty_levels ?? []}
              tags={config?.tags ?? []}
              selectedTag={selectedTag}
              onSelectedTagChange={setSelectedTag}
              difficultyCounts={facetCounts.difficultyCounts}
              difficulties={difficulties}
              institutions={sourceOptions?.institutions}
              institutionCounts={sourceFacetQuery.data}
              institutionYears={institutionYears}
              onInstitutionYearsChange={setInstitutionYears}
              onDifficultiesChange={setDifficulties}
              avoidRecent
              avoidRecentDays={avoidRecentDays}
              onAvoidRecentChange={setAvoidRecentDays}
              footerAction={{ label: "Generate question", onClick: () => getRandomQuestion(false) }}
            />
          </>
        }
      />

      <div className="min-w-0">
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

          {loading && (
            <Panel className="grid min-h-80 place-items-center p-8">
              <InkLoader messages={["Dipping the pen…", "Consulting the ledger…", "Ruling the margin…", "Choosing a question…"]} />
            </Panel>
          )}

          {!current && !loading && !error && (
            <Panel className="grid min-h-80 place-items-center p-8 text-center">
              <div>
                <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-secondary text-primary">
                  <Shuffle className="size-5" />
                </div>
                <h2 className="font-display text-2xl font-semibold">Ready when you are</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  {matchingCount === 0
                    ? "No questions match your current filters — loosen them and try again."
                    : `${matchingCount} questions match your current filters. Draw one at random to begin.`}
                </p>
                <Button className="mt-5" onClick={() => getRandomQuestion(false)} disabled={loading}>
                  <Shuffle />
                  Get Random Question
                </Button>
              </div>
            </Panel>
          )}

          {current && (
            <QuestionSurface
              question={current}
              submitted={submitted}
              selectedChoice={selectedChoice}
              onSelectChoice={current.type_key === "multiple_choice" ? setSelectedChoice : undefined}
              footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="outline" disabled={loading} onClick={() => getRandomQuestion(true)}>
                    <RefreshCw />
                    New Question
                  </Button>
                  <Button
                    disabled={!submitted && current.type_key === "multiple_choice" && !selectedChoice}
                    onClick={() => {
                      if (submitted) {
                        setSubmitted(false);
                        return;
                      }
                      handleSubmit();
                    }}
                  >
                    {submitted ? <Eye /> : <Check />}
                    {submitted ? "Hide answer" : current.type_key === "multiple_choice" ? "Submit answer" : "Submit & reveal"}
                  </Button>
                </div>
              }
            />
          )}
        </div>
    </div>
  );
}
