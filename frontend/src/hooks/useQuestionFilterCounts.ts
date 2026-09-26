import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CourseNode } from "../api/types";
import { effectiveNodeFilterIds } from "../lib/nodeFilters";

export function useQuestionFilterCounts(
  courseId: string | null,
  nodes: CourseNode[],
  selectedNodes: Set<string>,
  typeKeys: string[],
  difficulties: number[]
) {
  const nodeIds = useMemo(
    () => effectiveNodeFilterIds(nodes, selectedNodes).sort(),
    [nodes, selectedNodes]
  );
  const sortedTypes = useMemo(() => [...typeKeys].sort(), [typeKeys]);
  const sortedDifficulties = useMemo(() => [...difficulties].sort((a, b) => a - b), [difficulties]);

  const typeCounts = useQuery({
    queryKey: ["question-type-facet-counts", courseId, nodeIds, sortedDifficulties],
    queryFn: () => api.questionCounts(courseId as string, {
      node_ids: nodeIds,
      difficulties: sortedDifficulties,
    }),
    enabled: !!courseId,
  });
  const difficultyCounts = useQuery({
    queryKey: ["question-difficulty-facet-counts", courseId, nodeIds, sortedTypes],
    queryFn: () => api.questionCounts(courseId as string, {
      node_ids: nodeIds,
      type: sortedTypes.length ? sortedTypes : undefined,
    }),
    enabled: !!courseId,
  });

  return {
    typeCounts: typeCounts.data?.by_type,
    difficultyCounts: difficultyCounts.data?.by_difficulty,
  };
}
