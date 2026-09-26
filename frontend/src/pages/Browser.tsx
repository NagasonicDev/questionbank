import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../api/client";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { useCourseConfig } from "../hooks/useCourseConfig";
import { LoadingState, PageHeader, Panel, Meta, Pagination } from "../components/system";
import { FilterMenu } from "../components/FilterMenu";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { flattenCounts } from "../components/NodeTree";
import { MathText } from "../components/MathText";
import { effectiveNodeFilterIds } from "../lib/nodeFilters";
import { useQuestionFilterCounts } from "../hooks/useQuestionFilterCounts";

const PAGE_SIZE = 20;
const BROWSE_STATE_KEY = "qb-browser-state";

interface BrowserState {
  courseId: string | null;
  selectedNodes: Set<string>;
  typeKeys: string[];
  difficulties: number[];
  institutionYears: Record<string, number[]>;
  search: string;
  sort: string;
  page: number;
}

function readBrowserState(courseId: string | null): BrowserState {
  const defaults: BrowserState = { courseId, selectedNodes: new Set(), typeKeys: [], difficulties: [], institutionYears: {}, search: "", sort: "created_desc", page: 1 };
  if (!courseId) return defaults;
  try {
    const saved = JSON.parse(localStorage.getItem(BROWSE_STATE_KEY) ?? "null");
    const value = saved?.[courseId];
    if (!value) return defaults;
    return {
      ...defaults,
      selectedNodes: new Set(Array.isArray(value.selectedNodes) ? value.selectedNodes : []),
      typeKeys: Array.isArray(value.typeKeys) ? value.typeKeys : [],
      difficulties: Array.isArray(value.difficulties) ? value.difficulties : [],
      institutionYears: value.institutionYears && typeof value.institutionYears === "object" ? value.institutionYears : {},
      search: typeof value.search === "string" ? value.search : "",
      sort: sortOptions.some((option) => option.value === value.sort) ? value.sort : "created_desc",
      page: Number.isInteger(value.page) && value.page > 0 ? value.page : 1,
    };
  } catch {
    return defaults;
  }
}

function writeBrowserState(state: BrowserState) {
  if (!state.courseId) return;
  try {
    const saved = JSON.parse(localStorage.getItem(BROWSE_STATE_KEY) ?? "{}") as Record<string, unknown>;
    saved[state.courseId] = {
      selectedNodes: [...state.selectedNodes], typeKeys: state.typeKeys, difficulties: state.difficulties,
      institutionYears: state.institutionYears, search: state.search, sort: state.sort, page: state.page,
    };
    localStorage.setItem(BROWSE_STATE_KEY, JSON.stringify(saved));
  } catch {
    // Keep browsing usable if storage is unavailable or full.
  }
}

const sortOptions = [
  { value: "created_desc", label: "Newest first" },
  { value: "created_asc", label: "Oldest first" },
  { value: "difficulty_asc", label: "Difficulty ↑" },
  { value: "difficulty_desc", label: "Difficulty ↓" },
  { value: "random", label: "Random" },
];

export function Browser() {
  const { courseId } = useActiveCourse();
  const { data: config } = useCourseConfig(courseId);

  const [storedState, setStoredState] = useState<BrowserState>(() => readBrowserState(courseId));
  const browserState = storedState.courseId === courseId ? storedState : readBrowserState(courseId);
  const { selectedNodes, typeKeys, difficulties, institutionYears, search, sort, page } = browserState;
  function updateState(patch: Partial<Omit<BrowserState, "courseId">>) {
    const next = { ...browserState, ...patch, courseId };
    setStoredState(next);
    writeBrowserState(next);
  }
  useEffect(() => {
    if (storedState.courseId !== courseId) {
      setStoredState(readBrowserState(courseId));
      return;
    }
    if (!courseId) return;
    writeBrowserState(storedState);
  }, [courseId, storedState.courseId, selectedNodes, typeKeys, difficulties, institutionYears, search, sort, page]);
  const { data: sourceOptions } = useQuery({ queryKey: ["question-source-options", courseId], queryFn: () => api.questionSourceOptions(courseId as string), enabled: !!courseId });

  const { data: counts } = useQuery({
    queryKey: ["question-counts", courseId],
    queryFn: () => api.questionCounts(courseId as string),
    enabled: !!courseId,
  });
  const flatCounts = useMemo(() => (counts ? flattenCounts(counts.by_node) : {}), [counts]);
  const effectiveNodeIds = useMemo(
    () => effectiveNodeFilterIds(config?.nodes ?? [], selectedNodes),
    [config?.nodes, selectedNodes]
  );
  const facetCounts = useQuestionFilterCounts(
    courseId, config?.nodes ?? [], selectedNodes, typeKeys, difficulties
  );

  const { data: results, isLoading } = useQuery({
    queryKey: ["questions", courseId, effectiveNodeIds, typeKeys, difficulties, institutionYears, search, sort, page],
    queryFn: () => api.listQuestions(courseId as string, {
      node_id: effectiveNodeIds.length ? effectiveNodeIds : undefined,
      type: typeKeys.length ? typeKeys : undefined,
      difficulty: difficulties.length ? difficulties : undefined,
      source_filters: Object.entries(institutionYears).map(([institution, years]) => ({ institution, years })),
      q: search || undefined,
      sort,
      page,
      page_size: PAGE_SIZE,
    }),
    enabled: !!courseId,
  });

  function handleReset() {
    updateState({ selectedNodes: new Set(), typeKeys: [], difficulties: [], institutionYears: {}, search: "", page: 1 });
  }

  if (!courseId) {
    return <p className="text-sm text-muted-foreground">Select a course to browse its question bank.</p>;
  }

  const totalPages = results ? Math.max(1, Math.ceil(results.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        eyebrow="Browse"
        title="Question Bank"
        description="Search, filter and inspect every question in the active course."
        actions={
          <FilterMenu
            nodes={config?.nodes ?? []}
            counts={flatCounts}
            selectedNodes={selectedNodes}
            onSelectedNodesChange={(next) => {
              updateState({ page: 1, selectedNodes: next });
            }}
            onReset={handleReset}
            questionTypes={config?.question_types ?? []}
            typeCounts={facetCounts.typeCounts}
            typeKeys={typeKeys}
            onTypeKeysChange={(keys) => {
              updateState({ page: 1, typeKeys: keys });
            }}
            difficultyLevels={config?.difficulty_levels ?? []}
            difficultyCounts={facetCounts.difficultyCounts}
            difficulties={difficulties}
            institutions={sourceOptions?.institutions}
            institutionYears={institutionYears}
            onInstitutionYearsChange={(values) => updateState({ page: 1, institutionYears: values })}
            onDifficultiesChange={(levels) => {
              updateState({ page: 1, difficulties: levels });
            }}
          />
        }
      />

      <div className="min-w-0 space-y-3">
        <Panel className="p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search question text"
                value={search}
                onChange={(e) => {
                  updateState({ page: 1, search: e.target.value });
                }}
              />
            </div>
            <Select value={sort} onValueChange={(value) => updateState({ sort: value, page: 1 })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <Meta>{isLoading ? "Loading…" : `${results?.total ?? 0} matching questions`}</Meta>
            <Meta>
              Page {page} of {totalPages}
            </Meta>
          </div>
        </Panel>

        <div className="mt-3 space-y-2">
          {!results && isLoading && (
            <Panel className="grid min-h-48 place-items-center p-8">
              <LoadingState label="Consulting the ledger…" />
            </Panel>
          )}
          {results?.items.map((item) => (
            <Link
              key={item.question_id}
              to={`/questions/${item.question_id}`}
              className="panel block p-4 transition hover:-translate-y-px hover:bg-surface"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Meta>{item.type_key.replace(/_/g, " ")}</Meta>
                {item.difficulty != null && (
                  <>
                    <span className="text-border">/</span>
                    <Meta>Difficulty {item.difficulty}</Meta>
                  </>
                )}
                {item.marks != null && (
                  <>
                    <span className="text-border">/</span>
                    <Meta>{item.marks} marks</Meta>
                  </>
                )}
                {item.source?.name && (
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {item.source.name}
                  </span>
                )}
              </div>
              <p className="text-[15px] leading-relaxed"><MathText text={item.snippet} /></p>
              {selectedNodes.size > 0 && (
                <p className="mt-2 text-xs text-accent-foreground">
                  {selectedNodes.size} {selectedNodes.size === 1 ? "topic" : "topics"} selected →
                </p>
              )}
            </Link>
          ))}
        </div>

        {results && results.items.length === 0 && !isLoading && (
          <Panel className="p-10 text-center text-sm text-muted-foreground">
            No questions match these filters.
          </Panel>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          onPrev={() => updateState({ page: Math.max(1, page - 1) })}
          onNext={() => updateState({ page: Math.min(totalPages, page + 1) })}
        />
      </div>
    </>
  );
}
