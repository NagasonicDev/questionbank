import type { ReactNode } from "react";
import { InlineMath, BlockMath } from "react-katex";
import "katex/dist/katex.min.css";
import type { ContentBlock, Question } from "../api/types";
import { assetUrl } from "../api/client";
import { Meta, Panel } from "./system";
import { MathText } from "./MathText";

function Block({ block }: { block: ContentBlock }) {
  const c = block.content;
  switch (block.block_type) {
    case "text":
      return <p className="text-[15px] leading-7"><MathText text={String(c.text ?? "")} /></p>;

    case "heading":
      return <h4 className="font-display mt-2 font-semibold"><MathText text={String(c.text ?? "")} /></h4>;

    case "equation":
      return c.display ? (
        <div className="my-1">
          <BlockMath math={c.latex} />
        </div>
      ) : (
        <InlineMath math={c.latex} />
      );

    case "image":
    case "diagram":
    case "graph":
      return (
        <figure className="my-2">
          <img
            src={assetUrl(c.asset_path ?? "")}
            alt={c.alt_text ?? ""}
            className="max-w-full rounded-md border border-border"
          />
          {c.caption && (
            <figcaption className="mt-1 text-[13px] text-muted-foreground">{c.caption}</figcaption>
          )}
        </figure>
      );

    case "table":
      return (
        <div className="my-2 overflow-x-auto">
          <table className="min-w-full border border-border text-sm">
            <thead>
              <tr>
                {c.columns?.map((col: string, i: number) => (
                  <th
                    key={i}
                    className="border border-border bg-muted/60 px-2 py-1 text-left font-medium"
                  >
                    <MathText text={String(col)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.rows?.map((row: string[], i: number) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border border-border px-2 py-1">
                      <MathText text={String(cell)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "list": {
      const Tag = c.ordered ? "ol" : "ul";
      return (
        <Tag className={`pl-6 ${c.ordered ? "list-decimal" : "list-disc"} space-y-1`}>
          {c.items?.map((item: string, i: number) => <li key={i}><MathText text={String(item)} /></li>)}
        </Tag>
      );
    }

    case "code":
      return (
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/60 p-3 font-mono text-[13px] leading-relaxed">
          <code>{c.code}</code>
        </pre>
      );

    case "answer_area":
      return (
        <div
          className="my-2 rounded-md border border-dashed border-border"
          style={{ height: `${(c.lines ?? 3) * 1.75}rem` }}
        />
      );

    case "page_break":
      return <hr className="my-4 border-border" />;

    default:
      return null;
  }
}

function BlockList({ blocks, interactiveChoices, selectedChoice, onSelectChoice, submitted, correctChoice }: {
  blocks: ContentBlock[];
  interactiveChoices?: boolean;
  selectedChoice?: string | null;
  onSelectChoice?: (choice: string) => void;
  submitted?: boolean;
  correctChoice?: string | null;
}) {
  return (
    <div className="space-y-3">
      {[...blocks]
        .sort((a, b) => a.position - b.position)
        .map((b) => (
          <div key={b.block_id}>
            {interactiveChoices && b.block_type === "list" && (b.content.items ?? []).some((item: string) => /^\s*\(?[A-Z]\)?[.)]\s*/i.test(item)) ? (
              <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Answer choices">
                {(b.content.items ?? []).map((item: string, i: number) => {
                  const match = String(item).match(/^\s*\(?([A-Z])\)?[.)]\s*(.*)$/i);
                  const label = match?.[1]?.toUpperCase() ?? String.fromCharCode(65 + i);
                  const chosen = selectedChoice === label;
                  const correct = correctChoice === label;
                  const style = submitted && correct ? "border-green-600 bg-green-100 text-green-950" : submitted && chosen ? "border-red-600 bg-red-100 text-red-950" : chosen ? "border-primary bg-primary/10" : "border-border hover:border-primary/60";
                  return <button key={i} type="button" disabled={submitted} onClick={() => onSelectChoice?.(label)} className={`flex items-start gap-3 rounded-md border-2 p-3 text-left transition-colors ${style}`}>
                    <span className="grid size-7 shrink-0 place-items-center rounded-full border font-mono text-xs font-semibold">{label}</span>
                    <span className="pt-0.5"><MathText text={match?.[2] ?? String(item)} /></span>
                  </button>;
                })}
              </div>
            ) : <Block block={b} />}
          </div>
        ))}
    </div>
  );
}

export function SourceLine({ source }: { source: Question["source"] }) {
  if (!source) return null;
  const parts = [source.name, source.year?.toString(), source.institution].filter(Boolean);
  return (
    <p className="mt-4 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
      Source: {parts.join(" · ")}
    </p>
  );
}

/** Renders a question's body exactly in content order, with source small and
 * secondary underneath. Answer/solution are opt-in reveals, never default. */
export function QuestionReader({ question, selectedChoice, onSelectChoice, submitted }: { question: Question; selectedChoice?: string | null; onSelectChoice?: (choice: string) => void; submitted?: boolean }) {
  const correctChoice = question.mcq_options?.some((option) => option.is_correct)
    ? String.fromCharCode(65 + question.mcq_options.findIndex((option) => option.is_correct))
    : question.answer.map((b) => String(b.content.text ?? "").trim().match(/\b([A-D])\b/i)?.[1]?.toUpperCase()).find(Boolean) ?? null;
  const structuredChoices = question.mcq_options?.length ? question.mcq_options : null;
  return (
    <article>
      <BlockList blocks={question.body} interactiveChoices={question.type_key === "multiple_choice" && !!onSelectChoice && !structuredChoices} selectedChoice={selectedChoice} onSelectChoice={onSelectChoice} submitted={submitted} correctChoice={correctChoice} />
      {structuredChoices && <div className="mt-4 grid gap-2 sm:grid-cols-2" role="group" aria-label="Answer choices">
        {structuredChoices.map((option, i) => {
          const label = String.fromCharCode(65 + i);
          const chosen = selectedChoice === label;
          const correct = correctChoice === label;
          const style = submitted && correct ? "border-green-600 bg-green-100 text-green-950" : submitted && chosen ? "border-red-600 bg-red-100 text-red-950" : chosen ? "border-primary bg-primary/10" : "border-border hover:border-primary/60";
          const optionBlocks = option.content.map((block, j) => ({ ...block, block_id: `practice-option-${i}-${j}`, slot: "body" as const, position: j }));
          return <button key={i} type="button" disabled={submitted} onClick={() => onSelectChoice?.(label)} className={`flex items-start gap-3 rounded-md border-2 p-3 text-left transition-colors ${style}`}>
            <span className="grid size-7 shrink-0 place-items-center rounded-full border font-mono text-xs font-semibold">{label}</span>
            <span className="pt-0.5"><BlockList blocks={optionBlocks} /></span>
          </button>;
        })}
      </div>}

      <SourceLine source={question.source} />

      {question.parts.length > 0 && (
        <div className="mt-6 space-y-6">
          {question.parts.map((part) => (
            <div key={part.question_id} className="border-l-2 border-border pl-4">
              <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                ({part.part_label})
                {part.marks != null && <span className="ml-2">[{part.marks} marks]</span>}
              </p>
              <BlockList blocks={part.body} />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function AnswerPart({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-border px-6 py-5 last:border-0 sm:grid-cols-[44px_1fr]">
      <span className="font-mono text-[11px] text-accent-foreground">{n}</span>
      <div>
        <h3 className="font-display font-semibold">{title}</h3>
        <div className="mt-2 text-sm leading-6 text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export function AnswerReveal({ question }: { question: Question }) {
  const hasMarking = question.marking_criteria.length > 0;
  const hasAnswer = question.answer.length > 0;
  const hasSolution = question.solution.length > 0;
  if (!hasMarking && !hasAnswer && !hasSolution) {
    return (
      <div className="answer-reveal border-t border-border bg-surface/60 px-6 py-5">
        <p className="text-sm italic text-muted-foreground">
          No marking guide, answer, or solution recorded for this question yet.
        </p>
      </div>
    );
  }
  return (
    <div className="answer-reveal border-t border-border bg-surface/60">
      {hasMarking && (
        <AnswerPart n="01" title="Marking guide">
          <MarkingGuideTable blocks={question.marking_criteria} />
        </AnswerPart>
      )}
      {hasAnswer && (
        <AnswerPart n="02" title="Answer">
          <BlockList blocks={question.answer} />
        </AnswerPart>
      )}
      {hasSolution && (
        <AnswerPart n="03" title="Worked solution">
          <BlockList blocks={question.solution} />
        </AnswerPart>
      )}
    </div>
  );
}

/** Exam-paper surface: meta header, ruled body, optional reveal + footer. */
export function QuestionSurface({
  question,
  submitted = false,
  footer,
  selectedChoice,
  onSelectChoice,
}: {
  question: Question;
  submitted?: boolean;
  footer?: ReactNode;
  selectedChoice?: string | null;
  onSelectChoice?: (choice: string) => void;
}) {
  const num = question.source?.original_question_no;
  const label = num
    ? `Question ${num}`
    : question.type_key.replace(/_/g, " ").toUpperCase();
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap gap-3 border-b border-border px-6 py-4">
        <Meta>{question.type_key.replace(/_/g, " ")}</Meta>
        {question.difficulty != null && <Meta>Difficulty {question.difficulty}</Meta>}
        {question.marks != null && <Meta>{question.marks} marks</Meta>}
        {question.source?.name && (
          <Meta className="ml-auto">{question.source.institution || question.source.name}</Meta>
        )}
      </div>
      <article className="question-paper p-6 sm:p-8">
        <p className="mb-5 font-mono text-xs text-muted-foreground">{label}</p>
        <QuestionReader question={question} selectedChoice={selectedChoice} onSelectChoice={onSelectChoice} submitted={submitted} />
      </article>
      {submitted && <AnswerReveal question={question} />}
      {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
    </Panel>
  );
}

// ===================== Marking guide table =====================
// The marking guide is shown as a two-column table (criteria | marks), one
// row per mark range/band. The allocation is parsed from conventional
// "N marks: ..." (or "... (N marks)") phrasing; list/text content becomes
// rows, and any other block type (equation, image, table, ...) is rendered
// below the table so nothing is lost.

const MARKS_PREFIX = /^(\d+(?:\.\d+)?)\s*(?:(?:-\s*|–\s*|—\s*|\bto\b\s+|\bor\b\s+|\/\s*)(\d+(?:\.\d+)?))?\s*marks?\b/i;
const MARKS_TRAIL = /\s*[([](\d+(?:\.\d+)?(?:\s*[-–—/]\s*\d+(?:\.\d+)?)?)\s*marks?\s*[)\]]\s*$/i;

function extractCriteriaRow(item: string): { criteria: string; marks: string } {
  const text = item.trim();
  const m = text.match(MARKS_PREFIX);
  if (m) {
    const alloc = m[2] ? `${m[1]}–${m[2]}` : m[1];
    const rest = text.slice(m[0].length).replace(/^[\s:–—:.()-]+/, "").trim();
    return { criteria: rest, marks: alloc };
  }
  const trail = text.match(MARKS_TRAIL);
  if (trail && trail.index != null) {
    return { marks: trail[1].trim().replace(/\s+/g, ""), criteria: text.slice(0, trail.index).trim() };
  }
  return { criteria: text, marks: "" };
}

function MarkingGuideTable({ blocks }: { blocks: ContentBlock[] }) {
  const rows: { criteria: string; marks: string }[] = [];
  const supplementary: ContentBlock[] = [];
  for (const b of blocks) {
    const c = b.content;
    if (b.block_type === "list") {
      for (const item of c.items ?? []) rows.push(extractCriteriaRow(String(item)));
    } else if (b.block_type === "text" && `${c.text ?? ""}`.trim()) {
      rows.push(extractCriteriaRow(String(c.text)));
    } else {
      supplementary.push(b);
    }
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <table className="min-w-full border border-border text-sm">
          <thead>
            <tr>
              <th className="border border-border bg-muted/60 px-3 py-1.5 text-left font-medium">
                Criteria
              </th>
              <th className="w-24 border border-border bg-muted/60 px-3 py-1.5 text-center font-medium">
                Marks
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="border border-border px-3 py-1.5 align-top">
                  {r.criteria || "\u00a0"}
                </td>
                <td className="border border-border px-3 py-1.5 text-center align-top">
                  {r.marks || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {supplementary.length > 0 && <BlockList blocks={supplementary} />}
    </div>
  );
}
