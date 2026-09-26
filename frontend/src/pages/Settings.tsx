import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Pencil, Trash2 } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { useCourseConfig } from "../hooks/useCourseConfig";
import { PageHeader, Panel } from "../components/system";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { clearAllData } from "../lib/db/indexeddb";
import { clearQuestions } from "../lib/data";
import { api } from "../api/client";
import { Input } from "../components/ui/input";

export function Settings() {
  const { theme, toggle } = useTheme();
  const { courseId } = useActiveCourse();
  const { data: config } = useCourseConfig(courseId);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Appearance and local preferences for Quaestio."
      />

      <Panel>
        <div className="flex items-center justify-between p-5">
          <div>
            <p className="font-medium">Dark theme</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Reduce glare while practising long sessions.
            </p>
          </div>
          <Switch checked={theme === "dark"} onCheckedChange={() => toggle()} />
        </div>
      </Panel>

      <InstitutionManager courseId={courseId} />

      <Panel>
        <div className="p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
              <BookOpen className="size-5" />
            </div>
            <div>
              <p className="font-medium">{config?.name ?? "None selected"}</p>
              <p className="text-xs text-muted-foreground">
                {config ? config.hierarchy.map((l) => l.label).join(" → ") : "No active course"}
              </p>
            </div>
          </div>
          <div className="mt-5 border-t border-border pt-4">
            <p className="label">Hierarchy labels</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {config?.hierarchy.map((l, i) => (
                <span
                  key={l.level_index}
                  className="rounded-md bg-secondary px-2.5 py-1.5 text-xs"
                >
                  <span className="mr-2 font-mono text-muted-foreground">{`0${i + 1}`}</span>
                  {l.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <p className="text-xs text-muted-foreground">
        More settings (default course, default difficulty, data directory, font size) land in a
        later build stage — this app is entirely local, so there's nothing here that touches the
        network.
      </p>

      <Panel>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="font-medium text-destructive">Clear questions</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Deletes all questions, images, practice history, imports and generated tests. Course
                structure and settings stay untouched.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!window.confirm("Delete all questions and related data? Course structure will be kept. This cannot be undone.")) return;
                try {
                  await clearQuestions();
                  window.location.reload();
                } catch (err) {
                  window.alert(`Couldn't clear questions.\n\n${err instanceof Error ? err.message : String(err)}`);
                }
              }}
            >
              <Trash2 />
              Clear questions
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="font-medium text-destructive">Clear everything</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Deletes all local data, including courses, course structure, questions and files.
                This cannot be undone.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!window.confirm("Delete EVERYTHING stored in this browser? This cannot be undone.")) return;
                await clearAllData();
                window.location.reload();
              }}
            >
              <Trash2 />
              Clear everything
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function InstitutionManager({ courseId }: { courseId: string | null }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["question-source-options", courseId],
    queryFn: () => api.questionSourceOptions(courseId as string),
    enabled: !!courseId,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingName, setSavingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rename(currentName: string) {
    const nextName = (drafts[currentName] ?? currentName).trim();
    if (!courseId || !nextName || nextName === currentName) return;
    setSavingName(currentName);
    setError(null);
    try {
      await api.renameInstitution(courseId, currentName, nextName);
      try {
        const saved = JSON.parse(localStorage.getItem("qb-browser-state") ?? "{}") as Record<string, any>;
        const years = saved[courseId]?.institutionYears;
        if (years && currentName in years) {
          const oldYears = Array.isArray(years[currentName]) ? years[currentName] as number[] : [];
          const newYears = Array.isArray(years[nextName]) ? years[nextName] as number[] : undefined;
          years[nextName] = newYears && newYears.length === 0 ? [] : oldYears.length === 0 ? [] : [...new Set([...(newYears ?? []), ...oldYears])];
          delete years[currentName];
        }
        localStorage.setItem("qb-browser-state", JSON.stringify(saved));
      } catch {
        // Renaming remains successful if saved browser preferences cannot be updated.
      }
      setDrafts((prev) => { const next = { ...prev, [nextName]: nextName }; delete next[currentName]; return next; });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["question-source-options", courseId] }),
        queryClient.invalidateQueries({ queryKey: ["questions"] }),
        queryClient.invalidateQueries({ queryKey: ["question"] }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename the institution.");
    } finally {
      setSavingName(null);
    }
  }

  return (
    <Panel>
      <div className="p-5">
        <h2 className="font-display text-lg font-semibold">Institutions</h2>
        <p className="mt-1 text-sm text-muted-foreground">Rename an institution to update every source and question currently grouped under it.</p>
        {!courseId ? <p className="mt-4 text-sm text-muted-foreground">Select a course to manage its institutions.</p> : !data?.institutions.length ? <p className="mt-4 text-sm text-muted-foreground">No institutions found for this course.</p> : <div className="mt-4 divide-y divide-border">{data.institutions.map(({ name, years }) => {
          const value = drafts[name] ?? name;
          return <div key={name} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">{name}</p><p className="text-xs text-muted-foreground">{years.length ? years.join(", ") : "Year not recorded"}</p></div>
            <Input aria-label={`Rename ${name}`} value={value} onChange={(event) => setDrafts((prev) => ({ ...prev, [name]: event.target.value }))} className="sm:max-w-xs" />
            <Button size="sm" variant="outline" disabled={savingName !== null || !value.trim() || value.trim() === name} onClick={() => void rename(name)}>
              <Pencil />{savingName === name ? "Saving…" : "Rename"}
            </Button>
          </div>;
        })}</div>}
        {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
      </div>
    </Panel>
  );
}
