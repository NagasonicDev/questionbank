import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

/* ------------------------------------------------------------------ */
/* Layout primitives used across every page                            */
/* ------------------------------------------------------------------ */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
      <div className="min-w-0">
        <p className="label mb-1.5">{eyebrow}</p>
        <h1 className="font-display text-3xl font-semibold leading-tight sm:text-[34px]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("panel", className)}>{children}</section>;
}

export function LoadingState({
  label = "Quaestio is pondering…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <InkLoader messages={[label]} className={className} />
  );
}

export function InkLoader({
  messages = ["Quaestio is pondering…"],
  className,
  intervalMs = 5900,
}: {
  messages?: string[];
  className?: string;
  intervalMs?: number;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % messages.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [messages.length, intervalMs]);

  return (
    <div className={cn("ink-loader", className)} role="status" aria-live="polite">
      <span className="ink-loader-q font-display" aria-hidden="true">Q</span>
      <div className="ink-rule" aria-hidden="true">
        <span className="ink-rule-line" />
      </div>
      <div className="ink-drops" aria-hidden="true"><span /><span /><span /></div>
      <p className="label ink-loader-message">{messages[index % messages.length]}</p>
    </div>
  );
}

export function PanelHead({
  title,
  note,
  action,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
      <div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </div>
      {action}
    </div>
  );
}

export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("font-mono text-[10px] uppercase text-muted-foreground", className)}>
      {children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

export function Stat({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel className="p-4">
      <p className="label">{title}</p>
      <div className="mt-2">{children}</div>
    </Panel>
  );
}

export function MiniRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="space-y-1.5">
      {rows.map(([name, value]) => (
        <div key={name} className="flex justify-between text-xs">
          <span className="text-muted-foreground capitalize">{name}</span>
          <span className="font-mono">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function Bars({ bars }: { bars: Array<[string, number]> }) {
  return (
    <div className="space-y-2 pt-1">
      {bars.map(([name, value]) => (
        <div key={name}>
          <div className="mb-1 flex justify-between text-[11px]">
            <span className="capitalize">{name}</span>
            <span className="font-mono">{value.toFixed(2)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-accent-foreground"
              style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-5 flex items-center justify-between">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={onPrev}>
        ← Previous
      </Button>
      <span className="font-mono text-xs text-muted-foreground">
        {page} of {totalPages}
      </span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={onNext}>
        Next →
      </Button>
    </div>
  );
}
