import { useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "../api/client";
import { NodeTree } from "./NodeTree";
import { BlockEditor, blocksToPayload, emptyBlock, type EditableBlock } from "./BlockEditor";
import type { CourseFullConfig, ContentBlock, Question } from "../api/types";
import { Field, Panel, PanelHead } from "./system";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

function toEditable(blocks: ContentBlock[]): EditableBlock[] {
  return blocks
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((b) => ({ tempId: b.block_id, block_type: b.block_type, content: b.content }));
}

interface QuestionEditorProps {
  config: CourseFullConfig;
  existing?: Question;      // omit for "create new"
  onSaved: () => void;
  onCancel: () => void;
}

export function QuestionEditor({ config, existing, onSaved, onCancel }: QuestionEditorProps) {
  const [typeKey, setTypeKey] = useState(existing?.type_key ?? config.question_types[0] ?? "short_answer");
  const [difficulty, setDifficulty] = useState<number | null>(existing?.difficulty ?? null);
  const [marks, setMarks] = useState<string>(existing?.marks?.toString() ?? "");
  const [nodeIds, setNodeIds] = useState<Set<string>>(new Set(existing?.node_ids ?? []));
  const [tags, setTags] = useState(existing?.tags.join(", ") ?? "");
  const [sourceName, setSourceName] = useState(existing?.source?.name ?? "");
  const [sourceYear, setSourceYear] = useState(existing?.source?.year?.toString() ?? "");
  const [sourceInstitution, setSourceInstitution] = useState(existing?.source?.institution ?? "");
  const [sourceOriginalNo, setSourceOriginalNo] = useState(existing?.source?.original_question_no ?? "");
  const [reviewStatus, setReviewStatus] = useState(existing?.review_status ?? "approved");

  const [body, setBody] = useState<EditableBlock[]>(
    existing ? toEditable(existing.body) : [emptyBlock("text")]
  );
  const [answer, setAnswer] = useState<EditableBlock[]>(existing ? toEditable(existing.answer) : []);
  const [solution, setSolution] = useState<EditableBlock[]>(existing ? toEditable(existing.solution) : []);
  const [markingCriteria, setMarkingCriteria] = useState<EditableBlock[]>(
    existing ? toEditable(existing.marking_criteria) : []
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleNode(nodeId: string) {
    setNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        type_key: typeKey,
        difficulty: difficulty,
        marks: marks ? Number(marks) : null,
        node_ids: Array.from(nodeIds),
        tag_names: tags.split(",").map((t) => t.trim()).filter(Boolean),
        body: blocksToPayload(body),
        answer: blocksToPayload(answer),
        solution: blocksToPayload(solution),
        marking_criteria: blocksToPayload(markingCriteria),
        review_status: reviewStatus,
      };

      if (existing) {
        await api.updateQuestion(existing.question_id, payload);
      } else {
        await api.createQuestion({
          ...payload,
          course_id: config.course_id,
          source_name: sourceName || undefined,
          source_year: sourceYear ? Number(sourceYear) : undefined,
          source_institution: sourceInstitution || undefined,
          source_original_question_no: sourceOriginalNo || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save question");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-5">
        <div className="mb-1 flex items-center gap-3">
          <Button size="icon" variant="outline" onClick={onCancel}>
            <ArrowLeft />
          </Button>
          <div>
            <p className="label">Question editor</p>
            <h2 className="font-display text-2xl font-semibold">{existing ? "Edit question" : "New question"}</h2>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-5">
            <Panel>
              <div className="grid gap-4 p-5 sm:grid-cols-3">
                <Field label="Type">
                  <Select value={typeKey} onValueChange={setTypeKey}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {config.question_types.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Difficulty">
                  <Select
                    value={difficulty === null ? "none" : String(difficulty)}
                    onValueChange={(v) => setDifficulty(v === "none" ? null : Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any</SelectItem>
                      {config.difficulty_levels.map((d) => (
                        <SelectItem key={d.level} value={String(d.level)}>
                          {d.level} — {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Marks">
                  <Input type="number" step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)} />
                </Field>
              </div>
            </Panel>

            <BlockEditor label="Question body" blocks={body} onChange={setBody} />
            <BlockEditor label="Answer" blocks={answer} onChange={setAnswer} />
            <BlockEditor label="Solution / working" blocks={solution} onChange={setSolution} />
            <BlockEditor label="Marking criteria" blocks={markingCriteria} onChange={setMarkingCriteria} />
          </div>

          <div className="space-y-5">
            <Panel>
              <div className="p-5">
                <Field label={`Classification — ${config.hierarchy.map((l) => l.label).join(" / ")}`}>
                  <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border p-2">
                    <NodeTree nodes={config.nodes} selectedIds={nodeIds} onToggle={toggleNode} />
                  </div>
                  {config.nodes.length === 0 && (
                    <p className="mt-2 text-xs italic text-muted-foreground">
                      No categories yet — add some under the Structure tab first.
                    </p>
                  )}
                </Field>
              </div>
            </Panel>

            <Panel>
              <PanelHead title="Tags" />
              <div className="p-5">
                <Field label="Comma-separated">
                  <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="conceptual, calculation" />
                </Field>
              </div>
            </Panel>

            {!existing && (
              <Panel>
                <PanelHead title="Source metadata" />
                <div className="space-y-4 p-5">
                  <Field label="Source name">
                    <Input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="Trial Examination" />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Year">
                      <Input value={sourceYear} onChange={(e) => setSourceYear(e.target.value)} />
                    </Field>
                    <Field label="Original Q#">
                      <Input value={sourceOriginalNo} onChange={(e) => setSourceOriginalNo(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Institution (optional)">
                    <Input value={sourceInstitution} onChange={(e) => setSourceInstitution(e.target.value)} />
                  </Field>
                </div>
              </Panel>
            )}

            <Panel>
              <div className="flex items-center justify-between p-5">
                <div>
                  <p className="font-medium">Approved</p>
                  <p className="mt-1 text-sm text-muted-foreground">Ready for practice and tests</p>
                </div>
                <Switch
                  checked={reviewStatus === "approved"}
                  onCheckedChange={(v) => setReviewStatus(v ? "approved" : "pending_review")}
                />
              </div>
            </Panel>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Create question"}
          </Button>
        </div>
      </div>
    </form>
  );
}