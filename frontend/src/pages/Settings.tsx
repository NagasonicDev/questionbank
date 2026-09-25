import { BookOpen, Trash2 } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { useCourseConfig } from "../hooks/useCourseConfig";
import { PageHeader, Panel } from "../components/system";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { clearAllData } from "../lib/db/indexeddb";

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
        <div className="flex items-center justify-between p-5">
          <div>
            <p className="font-medium text-destructive">Clear all questions</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Deletes every question, image and generated test stored in this browser. This cannot
              be undone.
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={async () => {
              if (!window.confirm("Delete ALL questions and data in this browser? This cannot be undone.")) return;
              await clearAllData();
              window.location.reload();
            }}
          >
            <Trash2 />
            Clear all data
          </Button>
        </div>
      </Panel>
    </div>
  );
}