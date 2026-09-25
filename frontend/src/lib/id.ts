export function newId(prefix: string): string {
  const hex = Math.random().toString(16).slice(2, 14).padEnd(12, "0");
  return `${prefix}_${hex}`;
}

export function nowUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(
    2,
    "0"
  )}:${String(d.getUTCSeconds()).padStart(2, "0")}.000000`;
}