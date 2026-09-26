import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { InlineMath, BlockMath } from "react-katex";
import "katex/dist/katex.min.css";
import type { BlockType } from "../api/types";
import { api, assetUrl } from "../api/client";
import { Meta, Panel, PanelHead } from "./system";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { normalizeEquationLatex } from "./MathText";

export interface EditableBlock {
  tempId: string;
  block_type: BlockType;
  content: Record<string, any>;
}

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  text: "Text",
  heading: "Heading",
  equation: "Equation",
  image: "Image",
  diagram: "Diagram",
  graph: "Graph",
  table: "Table",
  list: "List",
  code: "Code",
  answer_area: "Answer space",
  page_break: "Page break",
};

let counter = 0;
function newTempId() {
  counter += 1;
  return `tmp_${Date.now()}_${counter}`;
}

export function emptyBlock(type: BlockType): EditableBlock {
  const defaults: Record<BlockType, Record<string, any>> = {
    text: { text: "" },
    heading: { text: "", level: 3 },
    equation: { latex: "", display: true },
    image: { asset_path: "", alt_text: "", caption: "" },
    diagram: { asset_path: "", alt_text: "", caption: "" },
    graph: { asset_path: "", alt_text: "", caption: "" },
    table: { columns: ["", ""], rows: [["", ""]] },
    list: { ordered: false, items: [""] },
    code: { language: "", code: "" },
    answer_area: { lines: 3 },
    page_break: {},
  };
  return { tempId: newTempId(), block_type: type, content: defaults[type] };
}

export function blocksToPayload(blocks: EditableBlock[]) {
  return blocks.map((b) => ({ block_type: b.block_type, content: b.content }));
}

function AutoResizeTextarea({ value, onChange, ...props }: React.ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return <Textarea {...props} ref={ref} value={value} onChange={onChange} />;
}

interface BlockEditorProps {
  label: string;
  blocks: EditableBlock[];
  onChange: (blocks: EditableBlock[]) => void;
}

export function BlockEditor({ label, blocks, onChange }: BlockEditorProps) {
  const [addType, setAddType] = useState<BlockType>("text");

  function update(tempId: string, content: Record<string, any>) {
    onChange(blocks.map((b) => (b.tempId === tempId ? { ...b, content } : b)));
  }
  function remove(tempId: string) {
    onChange(blocks.filter((b) => b.tempId !== tempId));
  }
  function move(tempId: string, dir: -1 | 1) {
    const i = blocks.findIndex((b) => b.tempId === tempId);
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function add() {
    onChange([...blocks, emptyBlock(addType)]);
  }

  return (
    <Panel>
      <PanelHead
        title={label}
        action={
          <div className="flex items-center gap-1.5">
            <Select value={addType} onValueChange={(v) => setAddType(v as BlockType)}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(BLOCK_TYPE_LABELS) as BlockType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {BLOCK_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" onClick={add}>
              <Plus />
              Add block
            </Button>
          </div>
        }
      />
      <div className="space-y-2 p-4">
        {blocks.length === 0 && (
          <p className="text-xs italic text-muted-foreground">No content yet.</p>
        )}
        {blocks.map((block, i) => (
          <div key={block.tempId} className="rounded-lg border border-border bg-surface/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <Meta>{block.block_type.replace(/_/g, " ")}</Meta>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="icon" disabled={i === 0} onClick={() => move(block.tempId, -1)}
                  className="h-7 w-7" title="Move up">
                  <ArrowUp />
                </Button>
                <Button type="button" variant="ghost" size="icon" disabled={i === blocks.length - 1} onClick={() => move(block.tempId, 1)}
                  className="h-7 w-7" title="Move down">
                  <ArrowDown />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(block.tempId)}
                  className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" title="Remove block">
                  <Trash2 />
                </Button>
              </div>
            </div>
            <BlockFields block={block} onChange={(c) => update(block.tempId, c)} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ImageBlockFields({ content, onChange }: { content: Record<string, any>; onChange: (patch: Record<string, any>) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await api.uploadAsset(file);
      onChange({ asset_path: res.asset_path });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {content.asset_path ? (
        <div className="flex items-start gap-2">
          <img
            src={assetUrl(content.asset_path)}
            alt={content.alt_text ?? ""}
            className="max-h-48 rounded-md border border-border"
          />
          <label className="cursor-pointer text-xs font-medium text-primary hover:underline">
            Replace image
            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted-foreground hover:bg-surface">
          {uploading ? "Uploading…" : "Click to upload an image"}
          <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
        </label>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Input value={content.alt_text ?? ""} onChange={(e) => onChange({ alt_text: e.target.value })} placeholder="Alt text (for accessibility)" />
      <Input value={content.caption ?? ""} onChange={(e) => onChange({ caption: e.target.value })} placeholder="Caption (optional)" />
    </div>
  );
}

function BlockFields({ block, onChange }: { block: EditableBlock; onChange: (content: Record<string, any>) => void }) {
  const c = block.content;
  const set = (patch: Record<string, any>) => onChange({ ...c, ...patch });

  switch (block.block_type) {
    case "text":
      return (
        <AutoResizeTextarea
          value={c.text ?? ""}
          onChange={(e) => set({ text: e.target.value })}
          rows={3}
          placeholder="Question text…"
        />
      );

    case "heading":
      return (
        <div className="flex gap-2">
          <Input value={c.text ?? ""} onChange={(e) => set({ text: e.target.value })} placeholder="Heading text" />
          <Input type="number" min={1} max={6} value={c.level ?? 3} onChange={(e) => set({ level: Number(e.target.value) })}
            className="w-20" />
        </div>
      );

    case "equation":
      return (
        <div className="space-y-2">
          <Input
            value={c.latex ?? ""}
            onChange={(e) => set({ latex: e.target.value })}
            className="font-mono"
            placeholder="$x^2 - 5x + 6 = 0$ or 5 × 10^3"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={c.display ?? true} onCheckedChange={(v) => set({ display: v === true })} />
            Display (block) equation
          </label>
          {c.latex && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              {c.display ? <BlockMath math={normalizeEquationLatex(String(c.latex ?? ""))} errorColor="#b3261e" /> : <InlineMath math={normalizeEquationLatex(String(c.latex ?? ""))} errorColor="#b3261e" />}
            </div>
          )}
        </div>
      );

    case "image":
    case "diagram":
    case "graph":
      return <ImageBlockFields content={c} onChange={set} />;

    case "table": {
      const columns: string[] = c.columns ?? [];
      const rows: string[][] = c.rows ?? [];
      return (
        <div className="space-y-2">
          <div>
            <p className="label mb-1.5">Columns (comma-separated)</p>
            <Input
              value={columns.join(", ")}
              onChange={(e) => set({ columns: e.target.value.split(",").map((s) => s.trim()) })}
            />
          </div>
          <div>
            <p className="label mb-1.5">Rows (one per line, cells comma-separated)</p>
            <Textarea
              value={rows.map((r) => r.join(", ")).join("\n")}
              onChange={(e) => set({ rows: e.target.value.split("\n").map((line) => line.split(",").map((s) => s.trim())) })}
              rows={3}
            />
          </div>
        </div>
      );
    }

    case "list":
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={c.ordered ?? false} onCheckedChange={(v) => set({ ordered: v === true })} />
            Ordered list
          </label>
          <Textarea
            value={(c.items ?? []).join("\n")}
            onChange={(e) => set({ items: e.target.value.split("\n") })}
            rows={3}
            placeholder="One item per line"
          />
        </div>
      );

    case "code":
      return (
        <div className="space-y-2">
          <Input value={c.language ?? ""} onChange={(e) => set({ language: e.target.value })} placeholder="Language (e.g. python)" />
          <Textarea value={c.code ?? ""} onChange={(e) => set({ code: e.target.value })} rows={3} className="font-mono" />
        </div>
      );

    case "answer_area":
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Lines of space:</span>
          <Input type="number" min={1} value={c.lines ?? 3} onChange={(e) => set({ lines: Number(e.target.value) })}
            className="h-8 w-20" />
        </div>
      );

    case "page_break":
      return <p className="text-xs italic text-muted-foreground">No fields — inserts a page break.</p>;

    default:
      return null;
  }
}
