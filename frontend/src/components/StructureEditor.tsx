import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CirclePlus, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { CourseFullConfig, CourseNode, LevelDef } from "../api/types";
import { Panel, PanelHead } from "./system";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface StructureEditorProps {
  config: CourseFullConfig;
}

export function StructureEditor({ config }: StructureEditorProps) {
  const qc = useQueryClient();
  const [newLevelLabel, setNewLevelLabel] = useState("");
  const [levelError, setLevelError] = useState<string | null>(null);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["course", config.course_id] });
    qc.invalidateQueries({ queryKey: ["question-counts", config.course_id] });
  }

  async function addLevel() {
    if (!newLevelLabel.trim()) return;
    const nextIndex = config.hierarchy.length;
    await api.addLevel(config.course_id, { level_index: nextIndex, label: newLevelLabel.trim(), required: false });
    setNewLevelLabel("");
    refresh();
  }

  async function addRootNode() {
    const name = window.prompt(`New ${config.hierarchy[0]?.label ?? "category"} name:`);
    if (!name?.trim()) return;
    await api.createNode(config.course_id, { level_index: 0, name: name.trim() });
    refresh();
  }

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHead
          title="Hierarchy levels"
          note="The ordered labels used by the course tree, top to bottom."
          action={
            <div className="flex items-center gap-1.5">
              <Input
                value={newLevelLabel}
                onChange={(e) => setNewLevelLabel(e.target.value)}
                placeholder={`Level ${config.hierarchy.length + 1} name`}
                className="h-8 w-44"
              />
              <Button size="sm" onClick={addLevel} disabled={!newLevelLabel.trim()}>
                <Plus />
                Add level
              </Button>
            </div>
          }
        />
        <div className="divide-y divide-border p-2">
          {config.hierarchy.map((lv) => (
            <LevelRow key={lv.level_index} courseId={config.course_id} level={lv} onChanged={refresh} onError={setLevelError} />
          ))}
        </div>
        {levelError && <p className="px-5 py-2 text-xs text-destructive">{levelError}</p>}
      </Panel>

      <Panel>
        <PanelHead
          title={config.hierarchy[0]?.label ?? "Categories"}
          note="Rename nodes, set short codes, or add children at the next level."
          action={
            <Button size="sm" onClick={addRootNode}>
              <Plus />
              Add {config.hierarchy[0]?.label ?? "category"}
            </Button>
          }
        />
        <div className="p-5">
          {config.nodes.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No categories yet. Add your first {config.hierarchy[0]?.label?.toLowerCase() ?? "category"} above.
            </p>
          ) : (
            config.nodes.map((node) => (
              <NodeEditRow
                key={node.node_id}
                node={node}
                siblings={config.nodes}
                hierarchy={config.hierarchy}
                courseId={config.course_id}
                onChanged={refresh}
              />
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

function LevelRow({
  courseId, level, onChanged, onError,
}: { courseId: string; level: LevelDef; onChanged: () => void; onError: (e: string | null) => void }) {
  const [label, setLabel] = useState(level.label);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (label === level.label || !label.trim()) return;
    setSaving(true);
    try {
      await api.updateLevel(courseId, level.level_index, { ...level, label: label.trim() });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    onError(null);
    if (!window.confirm(`Delete the "${level.label}" level? This only works if no categories use it yet.`)) return;
    try {
      await api.deleteLevel(courseId, level.level_index);
      onChanged();
    } catch (err) {
      onError(
        err instanceof Error && err.message.includes("400")
          ? "Can't delete this level while it still has categories. Delete or move those first."
          : "Failed to delete level."
      );
    }
  }

  return (
    <div className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
      <span className="font-mono text-xs text-muted-foreground">{`0${level.level_index + 1}`}</span>
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={save}
        disabled={saving}
        className="h-8"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={remove}
        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
        title="Delete level"
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function NodeEditRow({
  node, siblings, hierarchy, courseId, onChanged, depth = 0,
}: {
  node: CourseNode; siblings: CourseNode[]; hierarchy: LevelDef[]; courseId: string;
  onChanged: () => void; depth?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  const [code, setCode] = useState(node.code ?? "");
  const nextLevel = hierarchy[node.level_index + 1];
  const index = siblings.findIndex((s) => s.node_id === node.node_id);

  async function save() {
    await api.updateNode(courseId, node.node_id, { name, code: code || null });
    setEditing(false);
    onChanged();
  }

  async function remove() {
    const childCount = node.children.length;
    const msg = childCount > 0
      ? `Delete "${node.name}" and its ${childCount} sub-${hierarchy[node.level_index + 1]?.label.toLowerCase() ?? "item"}(s)? Questions keep their other classifications and are never deleted.`
      : `Delete "${node.name}"? Any questions classified here keep their other classifications and are never deleted.`;
    if (!window.confirm(msg)) return;
    await api.deleteNode(courseId, node.node_id);
    onChanged();
  }

  async function addChild() {
    if (!nextLevel) return;
    const name = window.prompt(`New ${nextLevel.label} name, under "${node.name}":`);
    if (!name?.trim()) return;
    await api.createNode(courseId, { level_index: nextLevel.level_index, parent_node_id: node.node_id, name: name.trim() });
    onChanged();
  }

  async function move(dir: -1 | 1) {
    const target = siblings[index + dir];
    if (!target) return;
    await Promise.all([
      api.updateNode(courseId, node.node_id, { sort_order: target.sort_order }),
      api.updateNode(courseId, target.node_id, { sort_order: node.sort_order }),
    ]);
    onChanged();
  }

  return (
    <div className={`mb-3 rounded-lg border border-border ${depth > 0 ? "bg-surface/40 p-2.5" : "p-3"}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_110px_auto] items-center gap-2">
        {editing ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            className="h-8"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="justify-self-start min-w-0 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface"
          >
            {node.name}
          </button>
        )}

        {editing ? (
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            placeholder="code"
            className="h-8"
          />
        ) : (
          <span className="truncate font-mono text-[11px] text-muted-foreground">{node.code}</span>
        )}

        <div className="flex gap-1">
          {editing ? (
            <>
              <Button size="sm" onClick={save}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={index === 0}
                onClick={() => move(-1)}
                className="h-8 w-8"
                title="Move up"
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={index === siblings.length - 1}
                onClick={() => move(1)}
                className="h-8 w-8"
                title="Move down"
              >
                <ArrowDown />
              </Button>
              {nextLevel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={addChild}
                  className="h-8 w-8"
                  title={`+ ${nextLevel.label}`}
                >
                  <CirclePlus />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={remove}
                className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                title="Delete node"
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="ml-5 mt-2 space-y-2 border-l border-border pl-3">
          {node.children.map((child) => (
            <NodeEditRow
              key={child.node_id}
              node={child}
              siblings={node.children}
              hierarchy={hierarchy}
              courseId={courseId}
              onChanged={onChanged}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}