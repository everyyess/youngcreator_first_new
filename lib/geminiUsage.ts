export const geminiUsageStorageKey = "samsung-vvip-gemini-usage";
export const geminiUsageUpdatedEvent = "samsung-vvip-gemini-usage-updated";
export const geminiDailyUsageLimit = 20;

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
  const safeCount = Math.max(0, Math.min(geminiDailyUsageLimit, count));
  window.localStorage.setItem(geminiUsageStorageKey, JSON.stringify({ date: todayKey(), count: safeCount }));
  window.dispatchEvent(new CustomEvent(geminiUsageUpdatedEvent, { detail: { count: safeCount } }));
}

export function incrementGeminiUsageToday() {
  const next = Math.min(geminiDailyUsageLimit, readGeminiUsageToday() + 1);
  writeGeminiUsageToday(next);
  return next;
}
