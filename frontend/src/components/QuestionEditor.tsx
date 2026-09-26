import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { formatQuestionType } from "../lib/questionTypes";
import { ToggleButton } from "./FilterMenu";
import { BlockEditor, blocksToPayload, emptyBlock, type EditableBlock } from "./BlockEditor";
import type { CourseFullConfig, ContentBlock, CourseNode, Question } from "../api/types";
import { Field, Panel, PanelHead } from "./system";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";

interface EditableOption {
  blocks: EditableBlock[];
  isCorrect: boolean;
}

interface EditablePart {
  questionId?: string;
  label: string;
  marks: string;
  body: EditableBlock[];
  answer: EditableBlock[];
  solution: EditableBlock[];
  markingCriteria: EditableBlock[];
}

function toEditable(blocks: ContentBlock[]): EditableBlock[] {
  return blocks
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((b) => ({ tempId: b.block_id, block_type: b.block_type, content: b.content }));
}

function descendantIds(node: CourseNode): string[] {
  return node.children.flatMap((child) => [child.node_id, ...descendantIds(child)]);
}

function renderClassification(nodes: CourseNode[], selected: Set<string>, onToggle: (id: string) => void) {
  return nodes.map((node) => {
    const selectedBelow = node.children.some((child) =>
      selected.has(child.node_id) || descendantIds(child).some((id) => selected.has(id))
    );
    const checked = selected.has(node.node_id);
    return (
      <div key={node.node_id} className="space-y-2">
        <ToggleButton enabled={checked} onClick={() => onToggle(node.node_id)}>
          {node.code && <span className="mr-1 font-mono text-[11px] text-muted-foreground">{node.code}</span>}
          <span className="whitespace-normal break-words">{node.name}</span>
        </ToggleButton>
        {node.children.length > 0 && (checked || selectedBelow) && (
          <div className="ml-3 space-y-2 border-l border-border pl-3 sm:ml-5 sm:pl-4">
            {renderClassification(node.children, selected, onToggle)}
          </div>
        )}
      </div>
    );
  });
}

interface QuestionEditorProps {
  config: CourseFullConfig;
  existing?: Question;      // omit for "create new"
  onSaved: () => void;
  onCancel: () => void;
}

export function QuestionEditor({ config, existing, onSaved, onCancel }: QuestionEditorProps) {
  const navigate = useNavigate();
  const location = useLocation();
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
  const [options, setOptions] = useState<EditableOption[]>(existing?.mcq_options?.map((option) => ({
    blocks: option.content.map((block, i) => ({ tempId: `option-${option.position}-${i}`, block_type: block.block_type, content: block.content })),
    isCorrect: option.is_correct,
  })) ?? (typeKey === "multiple_choice" ? [
    { blocks: [emptyBlock("text")], isCorrect: false },
    { blocks: [emptyBlock("text")], isCorrect: false },
  ] : []));
  const [parts, setParts] = useState<EditablePart[]>(existing?.parts.map((part) => ({
    questionId: part.question_id,
    label: part.part_label ?? "",
    marks: part.marks?.toString() ?? "",
    body: toEditable(part.body),
    answer: toEditable(part.answer),
    solution: toEditable(part.solution),
    markingCriteria: toEditable(part.marking_criteria),
  })) ?? []);

  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href^='#/']");
      if (!link || link.target === "_blank") return;
      const nextPath = link.getAttribute("href")?.slice(1).split(/[?#]/, 1)[0];
      if (!nextPath || nextPath === location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      pendingNavigation.current = () => navigate(nextPath);
      setShowLeavePrompt(true);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [hasUnsavedChanges, location.pathname, navigate]);

  const [showLeavePrompt, setShowLeavePrompt] = useState(false);

  function requestLeave(action: () => void) {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    pendingNavigation.current = action;
    setShowLeavePrompt(true);
  }

  function toggleNode(nodeId: string) {
    setHasUnsavedChanges(true);
    setNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        const dropDescendants = (nodes: CourseNode[]): void => {
          for (const node of nodes) {
            if (node.node_id === nodeId) {
              descendantIds(node).forEach((id) => next.delete(id));
              return;
            }
            dropDescendants(node.children);
          }
        };
        dropDescendants(config.nodes);
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
        mcq_options: typeKey === "multiple_choice" ? options.map((option) => ({
          content: blocksToPayload(option.blocks),
          is_correct: option.isCorrect,
        })) : [],
        parts: parts.map((part) => ({
          question_id: part.questionId,
          type_key: typeKey,
          part_label: part.label,
          marks: part.marks ? Number(part.marks) : null,
          body: blocksToPayload(part.body),
          answer: blocksToPayload(part.answer),
          solution: blocksToPayload(part.solution),
          marking_criteria: blocksToPayload(part.markingCriteria),
        })),
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
      const leave = pendingNavigation.current;
      pendingNavigation.current = null;
      if (leave) leave();
      else onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save question");
      if (pendingNavigation.current) setShowLeavePrompt(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} onChange={() => setHasUnsavedChanges(true)} onClick={(event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (button && button.type !== "submit" && !button.closest("[data-dismiss-editor]") && !button.closest("[data-editor-save]") ) {
        setHasUnsavedChanges(true);
      }
    }}>
      <div className="space-y-5">
        <div className="mb-1 flex items-center gap-3">
          <Button type="button" size="icon" variant="outline" data-dismiss-editor onClick={() => requestLeave(onCancel)}>
            <ArrowLeft />
          </Button>
          <div>
            <p className="label">Question editor</p>
            <h2 className="font-display text-2xl font-semibold">{existing ? "Edit question" : "New question"}</h2>
          </div>
        </div>

        <Panel>
          <div className="p-5">
            <Field label={`Classification — ${config.name} · ${config.hierarchy.map((l) => l.label).join(" / ")}`}>
              <div className="mt-2 max-h-[32rem] overflow-y-auto rounded-md border border-border p-3 sm:p-4">
                <div className="space-y-2">{renderClassification(config.nodes, nodeIds, toggleNode)}</div>
              </div>
              {config.nodes.length === 0 && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  No categories yet — add some under the Structure tab first.
                </p>
              )}
            </Field>
          </div>
        </Panel>

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
                          {formatQuestionType(t)}
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
            {typeKey === "multiple_choice" && (
              <Panel>
                <PanelHead title="Answer choices" action={<Button type="button" variant="outline" size="sm" onClick={() => setOptions((items) => [...items, { blocks: [emptyBlock("text")], isCorrect: false }])}><Plus /> Add choice</Button>} />
                <div className="space-y-4 p-5">
                  {options.map((option, index) => (
                    <div key={index} className="rounded-md border border-border p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Checkbox checked={option.isCorrect} onCheckedChange={(checked) => setOptions((items) => items.map((item, i) => ({ ...item, isCorrect: i === index ? checked === true : false })))} aria-label={`Mark choice ${String.fromCharCode(65 + index)} as correct`} />
                          <span className="text-sm font-medium">Choice {String.fromCharCode(65 + index)} {option.isCorrect ? "· Correct answer" : ""}</span>
                        </div>
                        <Button type="button" variant="ghost" size="icon" aria-label={`Remove choice ${String.fromCharCode(65 + index)}`} onClick={() => setOptions((items) => items.filter((_, i) => i !== index))}><Trash2 /></Button>
                      </div>
                      <BlockEditor label={`Choice ${String.fromCharCode(65 + index)} content`} blocks={option.blocks} onChange={(blocks) => setOptions((items) => items.map((item, i) => i === index ? { ...item, blocks } : item))} />
                    </div>
                  ))}
                  {options.length === 0 && <p className="text-sm text-muted-foreground">Add answer choices for this multiple choice question.</p>}
                </div>
              </Panel>
            )}
            <Panel>
              <PanelHead title="Question parts" action={<Button type="button" variant="outline" size="sm" onClick={() => setParts((items) => [...items, { label: String.fromCharCode(97 + items.length), marks: "", body: [emptyBlock("text")], answer: [], solution: [], markingCriteria: [] }])}><Plus /> Add part</Button>} />
              <div className="space-y-5 p-5">
                {parts.map((part, index) => (
                  <div key={part.questionId ?? `new-${index}`} className="space-y-4 rounded-md border border-border p-4">
                    <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                      <Field label="Part label"><Input value={part.label} onChange={(e) => setParts((items) => items.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} placeholder="a" /></Field>
                      <Field label="Marks"><Input type="number" step="0.5" value={part.marks} onChange={(e) => setParts((items) => items.map((item, i) => i === index ? { ...item, marks: e.target.value } : item))} /></Field>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove part ${part.label || index + 1}`} onClick={() => setParts((items) => items.filter((_, i) => i !== index))}><Trash2 /></Button>
                    </div>
                    <BlockEditor label={`Part ${part.label || index + 1} question`} blocks={part.body} onChange={(body) => setParts((items) => items.map((item, i) => i === index ? { ...item, body } : item))} />
                    <BlockEditor label={`Part ${part.label || index + 1} answer`} blocks={part.answer} onChange={(answer) => setParts((items) => items.map((item, i) => i === index ? { ...item, answer } : item))} />
                    <BlockEditor label={`Part ${part.label || index + 1} solution`} blocks={part.solution} onChange={(solution) => setParts((items) => items.map((item, i) => i === index ? { ...item, solution } : item))} />
                    <BlockEditor label={`Part ${part.label || index + 1} marking criteria`} blocks={part.markingCriteria} onChange={(markingCriteria) => setParts((items) => items.map((item, i) => i === index ? { ...item, markingCriteria } : item))} />
                  </div>
                ))}
                {parts.length === 0 && <p className="text-sm text-muted-foreground">Add parts to create a multi-part question.</p>}
              </div>
            </Panel>
          </div>

          <div className="space-y-5">
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
          <Button type="button" variant="outline" data-dismiss-editor onClick={() => requestLeave(onCancel)}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Create question"}
          </Button>
        </div>
      </div>
      {hasUnsavedChanges && (
        <div role="status" className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-4 rounded-lg border border-amber-500/40 bg-surface p-3 shadow-lg sm:bottom-6 sm:right-6">
          <p className="text-sm font-medium">You have unsaved changes</p>
          <Button type="button" size="sm" data-editor-save disabled={saving} onClick={() => formRef.current?.requestSubmit()}>
            <Save />{saving ? "Saving…" : "Save now"}
          </Button>
        </div>
      )}
      {showLeavePrompt && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-description" className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl">
            <h2 id="unsaved-title" className="font-display text-lg font-semibold">Unsaved changes</h2>
            <p id="unsaved-description" className="mt-2 text-sm text-muted-foreground">Would you like to save your changes before leaving?</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { pendingNavigation.current = null; setShowLeavePrompt(false); }}>Cancel</Button>
              <Button type="button" variant="outline" onClick={() => {
                const leave = pendingNavigation.current;
                pendingNavigation.current = null;
                setHasUnsavedChanges(false);
                setShowLeavePrompt(false);
                leave?.();
              }}>Discard changes</Button>
              <Button type="button" disabled={saving} onClick={() => { setShowLeavePrompt(false); formRef.current?.requestSubmit(); }}>Save and leave</Button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
