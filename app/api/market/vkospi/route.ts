import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const KRED_SERIES_URL = "https://kred.dev/ko/series/KRVKOSPI";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type KredObservation = { date: string; value: number };
type CachedPayload = {
  indicators: Array<{
    label: string;
    unit: string;
    source: string;
    observations: Array<{ time: string; value: string }>;
  }>;
  generatedAt: string;
};

let cache: { data: CachedPayload; expiry: number } | null = null;

function parseObservations(html: string): KredObservation[] {
  const match = html.match(/\\"initialData\\":(\[\{\\"date\\":[\s\S]*?\}\]),\\"mprDistribution\\"/);
  if (!match) throw new Error("KRED VKOSPI 시계열 형식을 확인할 수 없습니다.");

  const decoded = match[1].replace(/\\"/g, '"');
  const rows = JSON.parse(decoded) as KredObservation[];
  return rows.filter(
    (row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.value),
  );
}

export async function GET() {
  if (cache && cache.expiry > Date.now()) return NextResponse.json(cache.data);

  try {
    const response = await fetch(KRED_SERIES_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; YoungCreator/1.0; +https://github.com/everyyess/youngcreator_first_new)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 21_600 },
    });
    if (!response.ok) throw new Error(`KRED 응답 오류 (HTTP ${response.status})`);

    const rows = parseObservations(await response.text());
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 2);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    const observations = rows
      .filter((row) => row.date >= cutoffDate)
      .map((row) => ({ time: row.date.replace(/-/g, ""), value: String(row.value) }));

    if (observations.length === 0) throw new Error("최근 2년 VKOSPI 관측값이 없습니다.");

    const payload: CachedPayload = {
      indicators: [{
        label: "코스피 변동지수",
        unit: "%",
        source: "KRED (KRX 공식 공표 종가)",
        observations,
      }],
      generatedAt: new Date().toISOString(),
    };
    cache = { data: payload, expiry: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "VKOSPI 조회 중 오류" },
      { status: 502 },
    );
  }
}
