import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { cn } from "../lib/utils";
import { MathText } from "./MathText";

export function RecentQuestionsSidebar() {
  const { courseId } = useActiveCourse();

  const { data: recent } = useQuery({
    queryKey: ["recent-questions", courseId],
    queryFn: () => api.recentQuestions(courseId as string, 12),
    enabled: !!courseId,
    refetchInterval: 8000, // cheap way to stay current as the person practices in another panel
  });

  return (
    <aside className="hidden md:block">
      <div className="sticky top-[76px] panel p-3.5">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="label">Recent Questions</h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            {recent?.length ?? 0}
          </span>
        </div>

        {!courseId && (
          <p className="px-1 text-xs text-muted-foreground">Select a course to see activity.</p>
        )}
        {courseId && (!recent || recent.length === 0) && (
          <p className="px-1 text-xs text-muted-foreground">
            Nothing yet — questions you practice or view will show up here.
          </p>
        )}

        <div className="space-y-1">
          {recent?.map((item) => {
            const submitted = item.status === "completed";
            return (
              <Link
                key={item.question_id}
                to={`/questions/${item.question_id}`}
                className="block rounded-md p-2.5 transition hover:bg-surface"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      submitted ? "bg-success" : "bg-muted-foreground/40"
                    )}
                  />
                  <span
                    className={cn(
                      "font-mono text-[10px] uppercase",
                      submitted ? "text-success" : "text-muted-foreground"
                    )}
                  >
                    {item.status}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {item.type_key.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="line-clamp-2 text-[12px] leading-snug text-foreground">
                  {item.snippet ? <MathText text={item.snippet} /> : "(no text)"}
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
