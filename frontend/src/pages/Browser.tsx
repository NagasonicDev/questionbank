import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../api/client";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { useCourseConfig } from "../hooks/useCourseConfig";
import { PageHeader, Panel, Meta, Pagination } from "../components/system";
import { FilterMenu } from "../components/FilterMenu";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { flattenCounts } from "../components/NodeTree";
import { MathText } from "../components/MathText";

const PAGE_SIZE = 20;

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

  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [typeKeys, setTypeKeys] = useState<string[]>([]);
  const [difficulties, setDifficulties] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);

  const { data: counts } = useQuery({
    queryKey: ["question-counts", courseId],
    queryFn: () => api.questionCounts(courseId as string),
    enabled: !!courseId,
  });
  const flatCounts = useMemo(() => (counts ? flattenCounts(counts.by_node) : {}), [counts]);

  const { data: results, isLoading } = useQuery({
    queryKey: ["questions", courseId, Array.from(selectedNodes), typeKeys, difficulties, search, sort, page],
    queryFn: () => api.listQuestions(courseId as string, {
      node_id: selectedNodes.size ? Array.from(selectedNodes) : undefined,
      type: typeKeys.length ? typeKeys : undefined,
      difficulty: difficulties.length ? difficulties : undefined,
      q: search || undefined,
      sort,
      page,
      page_size: PAGE_SIZE,
    }),
    enabled: !!courseId,
  });

  function handleReset() {
    setSelectedNodes(new Set());
    setTypeKeys([]);
    setDifficulties([]);
    setSearch("");
    setPage(1);
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
              setPage(1);
              setSelectedNodes(next);
            }}
            onReset={handleReset}
            questionTypes={config?.question_types ?? []}
            typeCounts={counts?.by_type}
            typeKeys={typeKeys}
            onTypeKeysChange={(keys) => {
              setPage(1);
              setTypeKeys(keys);
            }}
            difficultyLevels={config?.difficulty_levels ?? []}
            difficultyCounts={counts?.by_difficulty}
            difficulties={difficulties}
            onDifficultiesChange={(levels) => {
              setPage(1);
              setDifficulties(levels);
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
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
            </div>
            <Select value={sort} onValueChange={setSort}>
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
          onPrev={() => setPage((p) => p - 1)}
          onNext={() => setPage((p) => p + 1)}
        />
      </div>
    </>
  );
}
