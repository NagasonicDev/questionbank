import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useCourseConfig(courseId: string | null) {
  return useQuery({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId as string),
    enabled: !!courseId,
  });
}
