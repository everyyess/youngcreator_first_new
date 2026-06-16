export const geminiUsageStorageKey = "samsung-vvip-gemini-usage";
export const geminiUsageUpdatedEvent = "samsung-vvip-gemini-usage-updated";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function readGeminiUsageToday() {
  if (typeof window === "undefined") return 0;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(geminiUsageStorageKey) ?? "{}") as { date?: string; count?: number };
    return parsed.date === todayKey() && typeof parsed.count === "number" ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export function writeGeminiUsageToday(count: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(geminiUsageStorageKey, JSON.stringify({ date: todayKey(), count }));
  window.dispatchEvent(new CustomEvent(geminiUsageUpdatedEvent, { detail: { count } }));
}

export function incrementGeminiUsageToday() {
  const next = readGeminiUsageToday() + 1;
  writeGeminiUsageToday(next);
  return next;
}
