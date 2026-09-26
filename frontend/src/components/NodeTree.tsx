import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CourseNode, NodeCount } from "../api/types";
import { Checkbox } from "./ui/checkbox";

interface NodeTreeProps {
  nodes: CourseNode[];
  counts?: Record<string, number>;
  selectedIds?: Set<string>;
  onToggle?: (nodeId: string) => void;
  /** Show a checkbox per row; when false the tree is display-only. */
  checks?: boolean;
  depth?: number;
}

function mergeCounts(counts: NodeCount[], acc: Record<string, number>) {
  for (const c of counts) {
    acc[c.node_id] = c.count;
    mergeCounts(c.children, acc);
  }
  return acc;
}

export function flattenCounts(byNode: NodeCount[]): Record<string, number> {
  return mergeCounts(byNode, {});
}

/** A tree of course nodes (topics/subtopics/dot points/...) with optional
 * click-to-filter checkboxes and question counts rolled up per branch. Works
 * for any hierarchy shape since it just walks whatever tree the course config
 * returns. */
export function NodeTree({
  nodes,
  counts,
  selectedIds,
  onToggle,
  checks = true,
  depth = 0,
}: NodeTreeProps) {
  return (
    <ul>
      {nodes.map((node) => (
        <NodeRow
          key={node.node_id}
          node={node}
          counts={counts}
          selectedIds={selectedIds}
          onToggle={onToggle}
          checks={checks}
          depth={depth}
        />
      ))}
    </ul>
  );
}

function NodeRow({
  node,
  counts,
  selectedIds,
  onToggle,
  checks,
  depth = 0,
}: Omit<NodeTreeProps, "nodes"> & { node: CourseNode }) {
  const [open, setOpen] = useState(depth < 1);
  const count = counts?.[node.node_id];
  const hasChildren = node.children.length > 0;
  const selected = selectedIds?.has(node.node_id) ?? false;
  const toggleable = !!onToggle;

  return (
    <li>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-2 transition hover:bg-surface">
        <div className="flex w-4 shrink-0 justify-center">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={open ? "Collapse" : "Expand"}
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : null}
        </div>

        <div className="flex min-w-0 items-start gap-2">
          {checks && (
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggle?.(node.node_id)}
              disabled={!toggleable}
            />
          )}
          <span className="min-w-0 whitespace-normal break-words text-sm font-medium">
            {node.code && (
              <span className="mr-1 font-mono text-[11px] text-muted-foreground">{node.code}</span>
            )}
            {node.name}
          </span>
        </div>

        {count !== undefined && (
          <span className="font-mono text-[11px] text-muted-foreground">{count}</span>
        )}
      </div>

      {hasChildren && open && (
        <div className="ml-4 border-l border-border pl-3">
          <NodeTree
            nodes={node.children}
            counts={counts}
            selectedIds={selectedIds}
            onToggle={onToggle}
            checks={checks}
            depth={depth + 1}
          />
        </div>
      )}
    </li>
  );
}
