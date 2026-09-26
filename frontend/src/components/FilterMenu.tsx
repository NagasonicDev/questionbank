import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Check, FolderTree, Gauge, Settings2, Shapes, SlidersHorizontal, X, School } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import type { CourseNode, DifficultyLevel } from "../api/types";

interface FilterMenuProps {
  nodes: CourseNode[];
  counts: Record<string, number>;
  selectedNodes: Set<string>;
  onSelectedNodesChange: (next: Set<string>) => void;
  onReset?: () => void;
  questionTypes: string[];
  typeCounts?: Record<string, number>;
  typeKeys: string[];
  onTypeKeysChange: (keys: string[]) => void;
  difficultyLevels: DifficultyLevel[];
  difficultyCounts?: Record<string, number>;
  difficulties: number[];
  onDifficultiesChange: (levels: number[]) => void;
  /** Adds a "Practice options" tab (practice flow) */
  avoidRecent?: boolean;
  avoidRecentDays?: number | null;
  onAvoidRecentChange?: (days: number | null) => void;
  /** Primary button shown in the popup footer (e.g. Practice's generate button) */
  footerAction?: { label: string; onClick: () => void };
  /** Optional note rendered at the bottom of the content area */
  hint?: string;
  inline?: boolean;
  institutions?: Array<{ name: string; years: number[] }>;
  institutionYears?: Record<string, number[]>;
  onInstitutionYearsChange?: (values: Record<string, number[]>) => void;
}

type Tab = "structure" | "difficulty" | "type" | "institution" | "options";

function collectChildIds(nodes: CourseNode[], acc: string[]) {
  for (const n of nodes) {
    acc.push(n.node_id);
    collectChildIds(n.children, acc);
  }
  return acc;
}

/** node id + every descendant id (needed so toggling a branch off also drops any nested picks) */
function subtreeIds(nodes: CourseNode[], id: string): string[] {
  for (const n of nodes) {
    if (n.node_id === id) return [id, ...collectChildIds(n.children, [])];
    const inner = subtreeIds(n.children, id);
    if (inner.length) return inner;
  }
  return [];
}

export function ToggleButton({
  enabled,
  onClick,
  right,
  children,
}: {
  enabled: boolean;
  onClick: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={enabled}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm font-medium text-foreground transition",
        enabled
          ? "border-primary bg-primary/10"
          : "border-border bg-surface/40 hover:bg-surface"
      )}
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-[4px] border transition",
          enabled
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40"
        )}
        aria-hidden
      >
        {enabled && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {right != null && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{right}</span>
      )}
    </button>
  );
}

/** Reusable "Filters" popup: a trigger button plus a centred modal with its
 * own sidebar. Each tab is a page of the popup — course structure (drill-down
 * on enable), difficulty and question type — where every option is a big
 * rectangular button that toggles like a checkbox. */
export function FilterMenu({
  nodes,
  counts,
  selectedNodes,
  onSelectedNodesChange,
  onReset,
  questionTypes,
  typeCounts,
  typeKeys,
  onTypeKeysChange,
  difficultyLevels,
  difficultyCounts,
  difficulties,
  onDifficultiesChange,
  avoidRecent = false,
  avoidRecentDays = null,
  onAvoidRecentChange,
  footerAction,
  hint,
  inline = false,
  institutions = [], institutionYears = {}, onInstitutionYearsChange,
}: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("structure");

  const activeCount = useMemo(() => {
    let n = selectedNodes.size;
    if (typeKeys.length > 0) n += 1;
    if (difficulties.length > 0) n += 1;
    if (Object.keys(institutionYears).length > 0) n += 1;
    if (avoidRecent && avoidRecentDays != null) n += 1;
    return n;
  }, [selectedNodes, typeKeys, difficulties, institutionYears, avoidRecent, avoidRecentDays]);

  const tabs = useMemo(() => {
    const list: Array<{ key: Tab; label: string; icon: typeof FolderTree; badge?: number }> = [
      { key: "structure", label: "Course structure", icon: FolderTree, badge: selectedNodes.size || undefined },
      { key: "difficulty", label: "Difficulty", icon: Gauge, badge: difficulties.length || undefined },
      { key: "type", label: "Question type", icon: Shapes, badge: typeKeys.length || undefined },
      { key: "institution", label: "Institution & year", icon: School, badge: Object.keys(institutionYears).length || undefined },
    ];
    if (avoidRecent) {
      list.push({ key: "options", label: "Practice options", icon: Settings2 });
    }
    return list;
  }, [selectedNodes, difficulties, typeKeys, institutionYears, avoidRecent]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggleNode(id: string) {
    const next = new Set(selectedNodes);
    if (next.has(id)) {
      for (const drop of subtreeIds(nodes, id)) next.delete(drop);
    } else {
      next.add(id);
    }
    onSelectedNodesChange(next);
  }

  function toggleDifficulty(level: number) {
    onDifficultiesChange(
      difficulties.includes(level)
        ? difficulties.filter((d) => d !== level)
        : [...difficulties, level]
    );
  }

  function toggleType(key: string) {
    onTypeKeysChange(
      typeKeys.includes(key) ? typeKeys.filter((t) => t !== key) : [...typeKeys, key]
    );
  }
  function toggleInstitution(name: string) {
    const next = { ...institutionYears };
    if (name in next) delete next[name]; else next[name] = [];
    onInstitutionYearsChange?.(next);
  }
  function toggleYear(institution: string, year: number) {
    const current = institutionYears[institution] ?? [];
    const nextYears = current.includes(year) ? current.filter((value) => value !== year) : [...current, year].sort((a, b) => b - a);
    onInstitutionYearsChange?.({ ...institutionYears, [institution]: nextYears });
  }
  function renderInstitutions() {
    return institutions.length === 0 ? <p className="text-sm text-muted-foreground">No institution information available.</p> : <div className="space-y-1.5">{institutions.map(({ name, years }) => {
      const enabled = name in institutionYears;
      const chosenYears = institutionYears[name] ?? [];
      return <div key={name} className="space-y-1.5"><ToggleButton enabled={enabled} onClick={() => toggleInstitution(name)}>{name}</ToggleButton>{enabled && years.length > 0 && <div className="ml-4 space-y-1.5 border-l border-border pl-3"><ToggleButton enabled={chosenYears.length === 0} onClick={() => onInstitutionYearsChange?.({ ...institutionYears, [name]: [] })}>All years</ToggleButton>{years.map((year) => <ToggleButton key={year} enabled={chosenYears.includes(year)} onClick={() => toggleYear(name, year)}>{year}</ToggleButton>)}</div>}</div>;
    })}</div>;
  }

  function renderNode(node: CourseNode, depth: number): ReactNode {
    const enabled = selectedNodes.has(node.node_id);
    const count = counts[node.node_id];
    return (
      <div key={node.node_id} className="space-y-1.5">
        <ToggleButton
          enabled={enabled}
          onClick={() => toggleNode(node.node_id)}
          right={count != null ? count : undefined}
        >
          {node.code && (
            <span className="mr-1 font-mono text-[11px] text-muted-foreground">{node.code}</span>
          )}
          {node.name}
        </ToggleButton>
        {enabled && node.children.length > 0 && (
          <div className="ml-4 space-y-1.5 border-l border-border pl-3">
            {node.children.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  const filterContent = (
    <div className={inline ? "grid gap-4 md:grid-cols-4" : "min-h-0 flex-1 overflow-y-auto p-5"}>
      <div>
        <p className="label mb-2">Course structure</p>
        {nodes.length === 0 ? <p className="text-sm text-muted-foreground">No course structure yet.</p> : <div className="space-y-1.5">{nodes.map((n) => renderNode(n, 0))}</div>}
      </div>
      <div><p className="label mb-2">Institution & year</p>{renderInstitutions()}</div>
      <div>
        <p className="label mb-2">Difficulty</p>
        <div className="space-y-1.5">
          {difficultyLevels.map((d) => <ToggleButton key={d.level} enabled={difficulties.includes(d.level)} onClick={() => toggleDifficulty(d.level)} right={difficultyCounts?.[String(d.level)]}>{d.label}</ToggleButton>)}
        </div>
      </div>
      <div>
        <p className="label mb-2">Question type</p>
        <div className="space-y-1.5">
          {questionTypes.map((t) => <ToggleButton key={t} enabled={typeKeys.includes(t)} onClick={() => toggleType(t)} right={typeCounts?.[t]}>{t.replace(/_/g, " ")}</ToggleButton>)}
        </div>
      </div>
      {onReset && activeCount > 0 && <div className="md:col-span-4"><Button size="sm" variant="outline" onClick={onReset}>Reset filters</Button></div>}
    </div>
  );

  if (inline) return filterContent;

  return (
    <>
      <Button variant="outline" size="sm" className="bg-surface/60" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="size-4" />
        Filters
        {activeCount > 0 && (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] text-primary-foreground">
            {activeCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px] animate-in fade-in-0"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex min-h-full items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Filters"
              className="panel flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200"
            >
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold">Filters</h2>
                  {activeCount > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {activeCount} active filter{activeCount === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  aria-label="Close filters"
                  className="shrink-0"
                >
                  <X />
                </Button>
              </header>

              <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                <nav
                  aria-label="Filter sections"
                  className="shrink-0 border-b border-border p-2 sm:w-48 sm:border-b-0 sm:border-r sm:p-3"
                >
                  <div className="flex flex-row gap-1 sm:flex-col">
                    {tabs.map((t) => {
                      const active = tab === t.key;
                      const Icon = t.icon;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setTab(t.key)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium transition",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-surface hover:text-foreground"
                          )}
                        >
                          <Icon className="size-4 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1">{t.label}</span>
                          {t.badge != null && (
                            <span
                              className={cn(
                                "font-mono text-[10px]",
                                active ? "text-primary-foreground/80" : "text-muted-foreground"
                              )}
                            >
                              {t.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </nav>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  {tab === "structure" && (
                    <div>
                      <p className="label mb-2">Course structure</p>
                      <p className="mb-3 text-xs text-muted-foreground">
                        Toggle a module to reveal its contents — each level expands as you enable
                        it. Enabling a branch includes everything beneath it.
                      </p>
                      {nodes.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No course structure yet.</p>
                      ) : (
                        <div className="space-y-1.5">{nodes.map((n) => renderNode(n, 0))}</div>
                      )}
                    </div>
                  )}

                  {tab === "difficulty" && (
                    <div>
                      <p className="label mb-2">Difficulty</p>
                      <p className="mb-3 text-xs text-muted-foreground">
                        Pick any number of difficulty levels — every selected level matches.
                      </p>
                      {difficultyLevels.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No difficulty levels defined.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {difficultyLevels.map((d) => (
                            <ToggleButton
                              key={d.level}
                              enabled={difficulties.includes(d.level)}
                              onClick={() => toggleDifficulty(d.level)}
                              right={
                                difficultyCounts?.[String(d.level)] != null
                                  ? difficultyCounts[String(d.level)]
                                  : undefined
                              }
                            >
                              {d.label}
                            </ToggleButton>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {tab === "type" && (
                    <div>
                      <p className="label mb-2">Question type</p>
                      <p className="mb-3 text-xs text-muted-foreground">
                        Pick any number of question types — every selected type matches.
                      </p>
                      {questionTypes.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No question types defined.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {questionTypes.map((t) => (
                            <ToggleButton
                              key={t}
                              enabled={typeKeys.includes(t)}
                              onClick={() => toggleType(t)}
                              right={
                                typeCounts?.[t] != null ? typeCounts[t] : undefined
                              }
                            >
                              {t.replace(/_/g, " ")}
                            </ToggleButton>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {tab === "institution" && <div><p className="label mb-2">Institution & year</p><p className="mb-3 text-xs text-muted-foreground">Choose an institution to include all its tests, then expand it to narrow the selection to specific years.</p>{renderInstitutions()}</div>}

                  {tab === "options" && (
                    <div>
                      <p className="label mb-2">Practice options</p>
                      <div className="flex items-start gap-2">
                        <Switch
                          checked={avoidRecentDays != null}
                          onCheckedChange={(c) => onAvoidRecentChange?.(c ? 7 : null)}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">Avoid recently seen</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Skip questions you've seen in the last few days.
                          </p>
                          <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                            <Input
                              type="number"
                              min={1}
                              className="h-8 w-20"
                              value={avoidRecentDays ?? 7}
                              onChange={(e) => onAvoidRecentChange?.(Number(e.target.value))}
                            />
                            days
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {hint && (
                    <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
                      {hint}
                    </p>
                  )}
                </div>
              </div>

              <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
                <div>
                  {onReset && activeCount > 0 && (
                    <Button size="sm" variant="outline" onClick={onReset}>
                      Reset
                    </Button>
                  )}
                </div>
                <Button
                  onClick={
                    footerAction
                      ? () => {
                          setOpen(false);
                          footerAction.onClick();
                        }
                      : () => setOpen(false)
                  }
                >
                  {footerAction ? footerAction.label : "Done"}
                </Button>
              </footer>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
