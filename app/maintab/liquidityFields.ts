export type LiquidityKind = "regular" | "lumpSum" | "emergency";
export type LiquidityPriority = "1순위" | "2순위" | "3순위" | "해당 없음";

export type LiquidityEntry = {
  id: string;
  priority: LiquidityPriority;
  purpose: string;
  timing: string;
  customTiming?: string;
  amount: string;
};

const PREFIX = "__liquidity_entries_v1__";
export const liquidityPriorities: LiquidityPriority[] = ["1순위", "2순위", "3순위", "해당 없음"];
export const regularTimingOptions = ["매월", "분기", "반기", "매년", "기타"];
export const lumpSumTimingOptions = ["1년 이내", "1~3년", "3~5년", "5년 이상"];

function makeId(index = 0) {
  return `liq-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

export function blankLiquidityEntry(index = 0): LiquidityEntry {
  return { id: makeId(index), priority: "해당 없음", purpose: "", timing: "", customTiming: "", amount: "" };
}

function splitLegacyText(value: string) {
  return value
    .replace(/(\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만)?\s*원?)\s*(?:과|및|그리고)\s*(?=\d+\s*년|내년|올해|[가-힣]+\s)/g, "$1\n")
    .split(/\n|;|ㆍ|·|,(?=\s*(?:\d|[가-힣]))/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeTiming(kind: LiquidityKind, raw: string) {
  const value = raw.replace(/\s+/g, "");
  if (!value) return "";
  if (kind === "regular") return value === "매달" ? "매월" : value;
  if (kind !== "lumpSum") return value;
  if (/^(올해|내년|1년이내)$/.test(value)) return "1년 이내";
  const year = Number(value.match(/(\d+)/)?.[1] ?? NaN);
  if (Number.isFinite(year)) {
    if (year <= 1) return "1년 이내";
    if (year <= 3) return "1~3년";
    if (year <= 5) return "3~5년";
    return "5년 이상";
  }
  if (value.includes("은퇴")) return "5년 이상";
  return value;
}

function parseLegacyEntry(text: string, kind: LiquidityKind, index: number): LiquidityEntry {
  const entry = blankLiquidityEntry(index);
  const amountMatch = text.match(/(\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만)?\s*원?)/);
  const timingMatch = kind === "regular"
    ? text.match(/(매월|매달|월\s*\d*회|분기|반기|매년|연\s*\d*회|기타)/)
    : kind === "lumpSum"
      ? text.match(/(\d+\s*년\s*(?:이내|후)?|1~3년|3~5년|5년\s*이상|내년|올해|은퇴\s*시점)/)
      : null;
  entry.amount = amountMatch?.[1]?.trim() ?? "";
  entry.timing = normalizeTiming(kind, timingMatch?.[1] ?? "");
  let purpose = text;
  if (amountMatch) purpose = purpose.replace(amountMatch[0], "");
  if (timingMatch) purpose = purpose.replace(timingMatch[0], "");
  entry.purpose = purpose.replace(/[,\-–—()]/g, " ").replace(/\s+/g, " ").trim() || text;
  return entry;
}

function normalizeEntries(entries: LiquidityEntry[]) {
  return entries.map((entry, index) => ({
    id: entry.id || makeId(index),
    priority: liquidityPriorities.includes(entry.priority) ? entry.priority : "해당 없음",
    purpose: entry.purpose ?? "",
    timing: entry.timing ?? "",
    customTiming: entry.customTiming ?? "",
    amount: entry.amount ?? "",
  }));
}

export function parseLiquidityEntries(value: string, kind: LiquidityKind): LiquidityEntry[] {
  const raw = value.trim();
  if (!raw) return [0, 1, 2].map((i) => blankLiquidityEntry(i));
  if (raw.startsWith(PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(PREFIX.length)) as LiquidityEntry[];
      const entries = Array.isArray(parsed) ? normalizeEntries(parsed) : [];
      return entries.length ? entries : [blankLiquidityEntry(0)];
    } catch {
      return [0, 1, 2].map((i) => blankLiquidityEntry(i));
    }
  }
  const legacy = splitLegacyText(raw).map((part, index) => parseLegacyEntry(part, kind, index));
  return legacy.length >= 3 ? legacy : [...legacy, ...Array.from({ length: 3 - legacy.length }, (_, i) => blankLiquidityEntry(legacy.length + i))];
}

export function serializeLiquidityEntries(entries: LiquidityEntry[]) {
  return `${PREFIX}${JSON.stringify(normalizeEntries(entries))}`;
}

export function isLiquidityEntryFilled(entry: LiquidityEntry) {
  return Boolean(entry.purpose.trim() || entry.timing.trim() || (entry.customTiming ?? "").trim() || entry.amount.trim());
}

export function formatLiquidityEntry(entry: LiquidityEntry, kind: LiquidityKind) {
  const timing = entry.timing === "기타" ? (entry.customTiming ?? "") : entry.timing;
  const parts = kind === "emergency"
    ? [entry.purpose, entry.amount]
    : [timing, entry.purpose, entry.amount];
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

export function formatLiquiditySummary(value: string, kind: LiquidityKind) {
  const rows = parseLiquidityEntries(value, kind)
    .filter(isLiquidityEntryFilled)
    .map((entry) => formatLiquidityEntry(entry, kind))
    .filter(Boolean);
  return rows.join(", ");
}

export function normalizeLiquidityValue(value: string, kind: LiquidityKind) {
  return serializeLiquidityEntries(parseLiquidityEntries(value, kind));
}
