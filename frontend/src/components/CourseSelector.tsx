import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Plus, Upload } from "lucide-react";
import { api } from "../api/client";
import { useActiveCourse } from "../hooks/useActiveCourse";
import { CreateCourseForm } from "./CreateCourseForm";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export function CourseSelector() {
  const { courseId, setCourseId } = useActiveCourse();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: courses } = useQuery({ queryKey: ["courses"], queryFn: api.listCourses });
  const active = courses?.find((c) => c.course_id === courseId);

  useEffect(() => {
    if (!courseId && courses && courses.length > 0) setCourseId(courses[0].course_id);
  }, [courses, courseId, setCourseId]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function startCreate() {
    setCreating(true);
    setOpen(true);
  }

  async function handleImportFile(file: File) {
    setImportError(null);
    setImportNotice(null);
    setImporting(true);
    try {
      const result = await api.importCourseFile(file);
      await qc.invalidateQueries({ queryKey: ["courses"] });
      await qc.invalidateQueries({ queryKey: ["course", result.course_id] });
      setCourseId(result.course_id);
      setImportNotice(`Imported '${result.course_name}'.`);
      setOpen(false);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Failed to import course");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="relative hidden min-w-0 items-center gap-1.5 border-l border-border pl-4 sm:flex" ref={ref}>
      <Button
        variant="outline"
        className="max-w-58 justify-between bg-surface/70"
        onClick={() => {
          setCreating(false);
          setOpen((o) => !o);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full bg-primary" />
          <span className="truncate">{active?.name ?? "Select course"}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </Button>

      <Button variant="ghost" size="sm" onClick={startCreate}>
        <Plus />
        New course
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={importing}
        onClick={() => fileInputRef.current?.click()}
        title="Import a course from a .qb bundle exported on another device"
      >
        <Upload />
        {importing ? "Importing…" : "Import course"}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".qb"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
        }}
      />

      {importError && (
        <p className="absolute left-4 top-16 z-50 max-w-72 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-destructive shadow-xl">
          {importError}
        </p>
      )}
      {importNotice && (
        <p className="absolute left-4 top-16 z-50 max-w-72 rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-xl">
          {importNotice}
        </p>
      )}

      {open && !creating && (
        <div
          role="listbox"
          className="absolute left-4 top-11 z-50 w-64 rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          <div className="py-0.5">
            {courses?.map((c) => {
              const isActive = c.course_id === courseId;
              return (
                <button
                  key={c.course_id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    setCourseId(c.course_id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition hover:bg-accent",
                    isActive && "text-accent-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      isActive ? "bg-primary" : "bg-muted-foreground/40"
                    )}
                  />
                  <span className="truncate">{c.name}</span>
                  {isActive && <Check className="ml-auto size-4 shrink-0" />}
                </button>
              );
            })}
            {(!courses || courses.length === 0) && (
              <p className="px-2.5 py-2 text-sm text-muted-foreground">No courses yet</p>
            )}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              fileInputRef.current?.click();
            }}
            className="flex w-full items-center gap-2 rounded-md border-t border-border px-2.5 py-2 text-left text-sm font-medium text-accent-foreground transition hover:bg-accent"
          >
            <Upload className="size-4" />
            Import course
          </button>
          <button
            onClick={startCreate}
            className="flex w-full items-center gap-2 rounded-md border-t border-border px-2.5 py-2 text-left text-sm font-medium text-accent-foreground transition hover:bg-accent"
          >
            <Plus className="size-4" />
            New course
          </button>
        </div>
      )}

      {open && creating && (
        <div className="absolute left-4 top-11 z-50 w-72 rounded-lg border border-border bg-popover p-3 shadow-xl">
          <CreateCourseForm
            onDone={() => {
              setCreating(false);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}