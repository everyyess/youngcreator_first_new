export type MarketCalendarEvent = {
  id: string;
  date: string;
  time: string;
  market: string;
  title: string;
  importance: "high" | "medium" | "low";
};

type ForexFactoryEvent = {
  date?: string;
  time?: string;
  country?: string;
  title?: string;
  impact?: string;
};

function normalizeImportance(value: string | undefined): MarketCalendarEvent["importance"] {
  const text = (value ?? "").toLowerCase();
  if (text.includes("high")) return "high";
  if (text.includes("medium")) return "medium";
  return "low";
}

function formatDate(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", weekday: "short" }).format(date);
}

export async function fetchMarketCalendar(): Promise<MarketCalendarEvent[]> {
  const response = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
    next: { revalidate: 60 * 60 },
  });
  if (!response.ok) throw new Error(`Calendar fetch failed: ${response.status}`);

  const data = await response.json() as ForexFactoryEvent[];
  return data
    .filter((item) => item.title)
    .slice(0, 12)
    .map((item, index) => ({
      id: `${item.date ?? ""}-${item.country ?? ""}-${item.title ?? index}`,
      date: formatDate(item.date),
      time: item.time ?? "",
      market: item.country ?? "Global",
      title: item.title ?? "",
      importance: normalizeImportance(item.impact),
    }));
}
