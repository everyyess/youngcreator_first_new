// 국내/미국 시장 개장 여부 판정 — 장 마감 후 무의미한(변동 없는) 시그널 재알림을 막기 위해 사용.
// DST(서머타임)가 있는 미국은 고정 UTC 오프셋 대신 America/New_York 타임존으로 직접 계산한다.

export function isKrMarketOpen(now: number): boolean {
  const kst = new Date(now + 9 * 3600_000);
  const day = kst.getUTCDay(); // 0=일 ~ 6=토 (KST로 shift된 값을 UTC getter로 읽음)
  if (day === 0 || day === 6) return false;
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return mins >= 9 * 60 && mins <= 15 * 60 + 30; // 09:00~15:30 KST
}

export function isUsMarketOpen(now: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = parseInt(get("hour"), 10) % 24; // 자정을 "24"로 표기하는 로케일 대비
  const minute = parseInt(get("minute"), 10);
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins <= 16 * 60; // 09:30~16:00 ET (서머타임 자동 반영)
}

const KR_INDEX_SYMBOLS = new Set(["^KS11", "^KQ11", "^KS200"]);
const US_INDEX_SYMBOLS = new Set(["^IXIC", "^GSPC", "^SOX", "^TNX", "^VIX"]);

/** 지수/환율/원자재 심볼별로 해당 시장이 열려 있는지 판정. 환율·원자재는 사실상 상시 거래되어 항상 true. */
export function isIndexMarketOpen(symbol: string, now: number): boolean {
  if (KR_INDEX_SYMBOLS.has(symbol)) return isKrMarketOpen(now);
  if (US_INDEX_SYMBOLS.has(symbol)) return isUsMarketOpen(now);
  return true;
}
