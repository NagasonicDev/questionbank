import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye } from "lucide-react";
import { api } from "../api/client";
import { LoadingState, PageHeader, Panel } from "../components/system";
import { QuestionSurface } from "../components/QuestionReader";
import { Button } from "../components/ui/button";

export function QuestionDetail() {
  const { questionId } = useParams<{ questionId: string }>();
  const [showAnswer, setShowAnswer] = useState(false);

  const { data: question, isLoading } = useQuery({
    queryKey: ["question", questionId],
    queryFn: () => api.getQuestion(questionId as string),
    enabled: !!questionId,
  });

  if (isLoading) return <div className="panel grid min-h-64 place-items-center p-8"><LoadingState /></div>;
  if (!question) return <p className="text-sm text-muted-foreground">Question not found.</p>;

  const sourceParts = question.source
    ? [
        question.source.institution,
        question.source.name,
        question.source.year?.toString(),
        question.source.original_question_no,
      ].filter(Boolean)
    : [];
  const source = sourceParts.join(" · ");

  return (
    <div>
      <PageHeader
        eyebrow="Question detail"
        title={`Question ${questionId}`}
        description="Complete question, source record and reviewed solution."
        actions={
          <Button variant="outline" asChild>
            <Link to="/browse">
              <ArrowLeft />
              Back to browser
            </Link>
          </Button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
        <QuestionSurface
          question={question}
          submitted={showAnswer}
          footer={
            question.answer.length > 0 || question.solution.length > 0 ? (
              <Button variant="outline" className="w-full" onClick={() => setShowAnswer((s) => !s)}>
                <Eye />
                {showAnswer ? "Hide answer" : "Show answer"}
              </Button>
            ) : undefined
          }
        />

        <Panel className="h-fit p-5 xl:sticky xl:top-[76px]">
          {question.review_status !== "approved" && (
            <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Pending review — not yet approved for practice.
            </div>
          )}
          <h2 className="font-display text-lg font-semibold">Metadata</h2>
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="label">Type</dt>
              <dd className="mt-1 text-sm">{question.type_key.replace(/_/g, " ")}</dd>
            </div>
            {question.difficulty != null && (
              <div>
                <dt className="label">Difficulty</dt>
                <dd className="mt-1 text-sm">{question.difficulty}</dd>
              </div>
            )}
            {question.marks != null && (
              <div>
                <dt className="label">Marks</dt>
                <dd className="mt-1 text-sm">{question.marks}</dd>
              </div>
            )}
            {question.tags.length > 0 && (
              <div>
                <dt className="label">Tags</dt>
                <dd className="mt-1 text-sm">{question.tags.join(", ")}</dd>
              </div>
            )}
            {question.review_status && (
              <div>
                <dt className="label">Review status</dt>
                <dd
                  className={
                    question.review_status !== "approved"
                      ? "mt-1 text-sm text-destructive"
                      : "mt-1 text-sm"
                  }
                >
                  {question.review_status !== "approved" ? "Pending review" : "Approved"}
                </dd>
              </div>
            )}
            {source && (
              <div>
                <dt className="label">Source</dt>
                <dd className="mt-1 text-sm">{source}</dd>
              </div>
            )}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
