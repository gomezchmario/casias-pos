// All timestamps in this app are LOCAL time — no UTC, no timezone offsets.
// Stored as ISO format: YYYY-MM-DDTHH:MM:SS (sortable as text).

export function nowLocalIso(): string {
  return toLocalIso(new Date());
}

export function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function localIsoToDate(iso: string): Date {
  // Parse YYYY-MM-DDTHH:MM:SS as local time (NOT UTC).
  const [datePart, timePart = "00:00:00"] = iso.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi, s] = timePart.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, s || 0);
}

export function todayLocalDate(): string {
  // Returns YYYY-MM-DD for "today" in local time.
  return nowLocalIso().slice(0, 10);
}

export function startOfWeek(d: Date, weekStartsOn: number): Date {
  // weekStartsOn: 0=Sunday, 1=Monday, ..., 6=Saturday
  const day = d.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  start.setDate(start.getDate() - diff);
  return start;
}

export function endOfWeek(d: Date, weekStartsOn: number): Date {
  const start = startOfWeek(d, weekStartsOn);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

export function formatHHMM(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const m = Math.abs(Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${sign}${h}h ${String(mm).padStart(2, "0")}m`;
}

export function formatDecimalHours(totalMinutes: number): string {
  return (totalMinutes / 60).toFixed(2);
}

export function diffMinutes(startIso: string, endIso: string): number {
  const start = localIsoToDate(startIso).getTime();
  const end = localIsoToDate(endIso).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}
