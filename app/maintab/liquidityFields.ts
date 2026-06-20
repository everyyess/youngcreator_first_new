export type LiquidityKind = "regular" | "lumpSum" | "emergency";
export type LiquidityPriority = "1" | "2" | "3" | "-";

export type LiquidityEntry = {
  id: string;
  priority: LiquidityPriority;
  purpose: string;
  timing: string;
  customTiming?: string;
  amount: string;
};

const PREFIX = "__liquidity_entries_v1__";
export const liquidityPriorities: LiquidityPriority[] = ["1", "2", "3", "-"];
const amountPattern = String.raw`\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만원|만\s*원|만|원)?`;

function makeId(index = 0) {
  return `liq-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

export function blankLiquidityEntry(index = 0): LiquidityEntry {
  return { id: makeId(index), priority: "-", purpose: "", timing: "", customTiming: "", amount: "" };
}

function splitLegacyText(value: string) {
  return value
    .replace(/(\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만)?\s*원?)\s*(?:과|및|그리고)\s*(?=\d+\s*년|내년|올해|[가-힣]+\s)/g, "$1\n")
    .split(/\n|;|ㆍ|·|(?<!\d),(?!\d)(?=\s*(?:\d|[가-힣]))/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeTiming(kind: LiquidityKind, raw: string) {
  const value = raw
    .replace(/\s+/g, "")
    .replace(/마다$/, "")
    .replace(/(?:뒤|후|이내)$/, "");
  if (!value) return "";
  if (kind === "regular") {
    if (value === "월" || value === "매달") return "매월";
    if (value === "매년") return "1년";
    return value;
  }
  if (kind !== "lumpSum") return value;
  if (value.includes("은퇴")) return "5년 이상";
  return value;
}

function normalizePriority(raw: unknown): LiquidityPriority {
  if (raw === "1" || raw === "1순위") return "1";
  if (raw === "2" || raw === "2순위") return "2";
  if (raw === "3" || raw === "3순위") return "3";
  return "-";
}

function cleanPurpose(raw: string) {
  return raw
    .replace(/^(?:월|매월|매달|분기|반기|매년)\s*/g, "")
    .replace(/(?:마다|뒤|후|이내)/g, " ")
    .replace(/(?:필요(?:해요|합니다|함)?|확보(?:해요|합니다|함)?|계획(?:입니다|함)?|예정(?:입니다)?|목적)$/g, " ")
    .replace(/[,\-–—()[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLegacyEntry(text: string, kind: LiquidityKind, index: number): LiquidityEntry {
  const entry = blankLiquidityEntry(index);
  const timingMatch = kind === "regular"
    ? text.match(/(매월|매달|월|분기|반기|매년|(?:\d+\s*(?:개월|년))\s*마다?)/)
    : kind === "lumpSum"
      ? text.match(/((?:\d+\s*(?:개월|년))\s*(?:뒤|후|이내)?|내년|올해|은퇴\s*시점)/)
      : null;
  const amountSource = timingMatch ? text.replace(timingMatch[0], " ") : text;
  const amountMatch = amountSource.match(new RegExp(`(${amountPattern})`));
  entry.amount = amountMatch?.[1]?.trim() ?? "";
  entry.timing = normalizeTiming(kind, timingMatch?.[1] ?? "");
  let purpose = text;
  if (amountMatch) purpose = purpose.replace(amountMatch[0], "");
  if (timingMatch) purpose = purpose.replace(timingMatch[0], "");
  entry.purpose = cleanPurpose(purpose) || cleanPurpose(text) || text;
  return entry;
}

function stringifyLiquidityPart(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const timing = record.timing ?? record.period ?? record.frequency ?? record.time ?? record.시기 ?? record.주기 ?? "";
  const purpose = record.purpose ?? record.goal ?? record.need ?? record.목적 ?? "";
  const amount = record.amount ?? record.money ?? record.금액 ?? "";
  return [timing, purpose, amount].filter((part) => typeof part === "string" && part.trim()).join(" ");
}

function parseJsonLikeEntries(raw: string, kind: LiquidityKind): LiquidityEntry[] | null {
  const trimmed = raw.trim();
  if (!/^[\[{]/.test(trimmed)) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed?.entries) ? parsed.entries : [parsed];
    const entries = values
      .map((value: unknown, index: number) => parseLegacyEntry(stringifyLiquidityPart(value), kind, index))
      .filter(isLiquidityEntryFilled);
    return entries.length ? entries : null;
  } catch {
    return null;
  }
}

function normalizeEntries(entries: LiquidityEntry[]) {
  return entries.map((entry, index) => ({
    id: entry.id || makeId(index),
    priority: normalizePriority(entry.priority),
    purpose: entry.purpose ?? "",
    timing: entry.timing ?? "",
    customTiming: entry.customTiming ?? "",
    amount: entry.amount ?? "",
  }));
}

export function parseLiquidityEntries(value: string, kind: LiquidityKind): LiquidityEntry[] {
  const raw = value.trim();
  if (!raw) return [blankLiquidityEntry(0)];
  if (raw.startsWith(PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(PREFIX.length)) as LiquidityEntry[];
      const entries = Array.isArray(parsed) ? normalizeEntries(parsed) : [];
      return entries.length ? entries : [blankLiquidityEntry(0)];
    } catch {
      return [blankLiquidityEntry(0)];
    }
  }
  const jsonEntries = parseJsonLikeEntries(raw, kind);
  if (jsonEntries) return jsonEntries;
  const legacy = splitLegacyText(raw).map((part, index) => parseLegacyEntry(part, kind, index));
  return legacy.length ? legacy : [blankLiquidityEntry(0)];
}

export function serializeLiquidityEntries(entries: LiquidityEntry[]) {
  return `${PREFIX}${JSON.stringify(normalizeEntries(entries))}`;
}

export function isLiquidityEntryFilled(entry: LiquidityEntry) {
  return Boolean(entry.purpose.trim() || entry.timing.trim() || (entry.customTiming ?? "").trim() || entry.amount.trim());
}

export function formatLiquidityEntry(entry: LiquidityEntry, kind: LiquidityKind) {
  const timing = entry.timing === "기타" ? (entry.customTiming ?? "") : entry.timing.trim();
  const displayTiming = kind === "regular" && timing && !timing.includes("매")
    ? `${timing}마다`
    : kind === "lumpSum" && timing
      ? `${timing.replace(/(?:뒤|후)$/, "")} 후`
      : timing;
  const parts = kind === "emergency"
    ? [entry.purpose, entry.amount]
    : [entry.purpose, displayTiming, entry.amount];
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
