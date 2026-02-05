export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function seasonLabelFromYear(startYear: number) {
  const nextYear = (startYear + 1) % 100;
  return `${startYear}-${String(nextYear).padStart(2, "0")}`;
}

export function currentSeasonStartYear(today = new Date()) {
  // NBA season typically starts in October. If before Oct, season start year is previous year.
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  return month >= 10 ? year : year - 1;
}

export function toIsoDate(dateStr: string) {
  // Accepts YYYY-MM-DD or YYYYMMDD and returns YYYY-MM-DD
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{8}$/.test(dateStr)) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  return dateStr;
}

export function toClickhouseDate(dateStr?: string | null) {
  const normalized = toIsoDate(String(dateStr ?? ""));
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

export function toClickhouseDateTime(input?: string | Date | null) {
  const date = input ? new Date(input) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${safe.getUTCFullYear()}-${pad(safe.getUTCMonth() + 1)}-${pad(safe.getUTCDate())} ${pad(
    safe.getUTCHours()
  )}:${pad(safe.getUTCMinutes())}:${pad(safe.getUTCSeconds())}`;
}

export function parseScoreMargin(raw?: string | number | null) {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return raw;
  if (raw === "TIE") return 0;
  const cleaned = raw.replace("+", "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isClutch(period: number, clock?: string, scoreMargin = 0) {
  // Clutch: last 5 minutes of 4th or OT and score within 5.
  if (period < 4) return 0;
  if (Math.abs(scoreMargin) > 5) return 0;
  if (!clock) return 0;
  // clock can be "PT11M45.00S" or "11:45" depending on endpoint
  if (clock.startsWith("PT")) {
    const match = clock.match(/PT(\d+)M(\d+(?:\.\d+)?)S/);
    if (!match) return 0;
    const minutes = Number(match[1]);
    return minutes <= 5 ? 1 : 0;
  }
  const parts = clock.split(":");
  if (parts.length >= 2) {
    const minutes = Number(parts[0]);
    return minutes <= 5 ? 1 : 0;
  }
  return 0;
}

export function guessShotZone(shotDistance?: number | null, shotType?: string | null) {
  if (!shotDistance && shotDistance !== 0) return "";
  if (shotType && /3pt|three/i.test(shotType)) return "three";
  if (shotDistance <= 4) return "rim";
  if (shotDistance <= 14) return "paint";
  if (shotDistance <= 22) return "mid-range";
  return "three";
}

export function extractUuid(input: unknown): string | null {
  if (!input) return null;
  const seen = new Set<string>();
  const stack: unknown[] = [input];
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === "string") {
      const match = value.match(uuidRegex);
      if (match) return match[0];
    } else if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
    } else if (value && typeof value === "object") {
      if (seen.has(value as any)) continue;
      seen.add(value as any);
      for (const v of Object.values(value as Record<string, unknown>)) {
        stack.push(v);
      }
    }
  }
  return null;
}

export function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
