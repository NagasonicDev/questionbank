import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { useCourseConfig } from "../hooks/useCourseConfig";
import { StructureEditor } from "../components/StructureEditor";
import { MathText } from "../components/MathText";
import { QuestionEditor } from "../components/QuestionEditor";
import { PageHeader, Panel, PanelHead, Meta, Pagination } from "../components/system";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import type { Question } from "../api/types";
import { Download, Plus, Pencil, Trash2, ExternalLink } from "lucide-react";

type Tab = "structure" | "questions";
const PAGE_SIZE = 20;

export function CourseSettings() {
  const { courseId } = useActiveCourse();
  const { data: config } = useCourseConfig(courseId);
  const [tab, setTab] = useState<Tab>("structure");
  const [actionError, setActionError] = useState<string | null>(null);

  if (!courseId || !config) {
    return <p className="text-sm text-muted-foreground">Select a course to manage its settings.</p>;
  }

  const handleSkill = async () => {
    setActionError(null);
    try {
      await api.downloadSkill(config.course_id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to download skill file");
    }
  };

  const handleExport = async () => {
    setActionError(null);
    try {
      await api.exportCourse(config.course_id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to export course");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Course management"
        title={config.name}
        description="Manage this course's structure and its questions directly."
        actions={
          <>
            <Button variant="outline" onClick={handleExport} title="Export this course as a .qb bundle you can import on another device.">
              <Download />
              Export course
            </Button>
            <Button
              variant="outline"
              onClick={handleSkill}
              title="Download a .skill file: general document-to-question instructions plus this course's specific structure and marking-guide rules, for use with an AI assistant to convert source exams into an importable JSON file."
            >
              <ExternalLink />
              Download skill file
            </Button>
          </>
        }
      />
      {actionError && (
        <p className="mb-4 text-sm text-destructive">{actionError}</p>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-5">
          <TabsTrigger value="structure">Structure</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
        </TabsList>
        <TabsContent value="structure" className="space-y-5">
          <StructureEditor config={config} />
        </TabsContent>
        <TabsContent value="questions">
          <QuestionManager config={config} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QuestionManager({ config }: { config: NonNullable<ReturnType<typeof useCourseConfig>["data"]> }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editorMode, setEditorMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  const { data: results, isLoading } = useQuery({
    queryKey: ["questions", config.course_id, "manage", page],
    queryFn: () => api.listQuestions(config.course_id, { page, page_size: PAGE_SIZE, sort: "created_desc" }),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["questions", config.course_id] });
    qc.invalidateQueries({ queryKey: ["question-counts", config.course_id] });
  }

  async function openEdit(questionId: string) {
    const q = await api.getQuestion(questionId);
    setEditingQuestion(q);
    setEditorMode("edit");
  }

  async function handleDelete(questionId: string) {
    if (!window.confirm("Delete this question permanently? This can't be undone.")) return;
    try {
      await api.deleteQuestion(questionId);
    } catch (err) {
      window.alert(`Couldn't delete this question.\n\n${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    refresh();
  }

  function closeEditor() {
    setEditorMode("closed");
    setEditingQuestion(null);
  }

  if (editorMode !== "closed") {
    return (
      <div>
        <QuestionEditor
          config={config}
          existing={editingQuestion ?? undefined}
          onSaved={() => { refresh(); closeEditor(); }}
          onCancel={closeEditor}
        />
      </div>
    );
  }

  const totalPages = results ? Math.max(1, Math.ceil(results.total / PAGE_SIZE)) : 1;

  return (
    <Panel>
      <PanelHead
        title="Course questions"
        note={isLoading ? "Loading…" : `${results?.total ?? 0} questions`}
        action={
          <Button size="sm" onClick={() => setEditorMode("create")}>
            <Plus />
            Add question
          </Button>
        }
      />
      <div className="divide-y divide-border">
        {results?.items.map((item) => (
          <div key={item.question_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="truncate font-serif"><MathText text={item.snippet} /></p>
              {(item.type_key || item.difficulty != null || item.marks != null) && (
                <Meta>
                  {[
                    item.type_key.replace(/_/g, " "),
                    item.difficulty != null && `Difficulty ${item.difficulty}`,
                    item.marks != null && `${item.marks} marks`,
                  ].filter(Boolean).join(" · ")}
                </Meta>
              )}
            </div>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" onClick={() => openEdit(item.question_id)}>
                <Pencil />
              </Button>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => handleDelete(item.question_id)}>
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {results && results.items.length === 0 && !isLoading && (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">No questions yet — add the first one above.</p>
      )}

      <div className="border-t border-border p-4">
        <Pagination page={page} totalPages={totalPages} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
      </div>
    </Panel>
  );
}
