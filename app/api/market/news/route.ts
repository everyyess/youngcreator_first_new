import { NextRequest, NextResponse } from "next/server";
import { fetchHankyungNews, type NewsCategory } from "@/lib/newsData";

export const runtime = "edge";

function normalizeCategory(value: string | null): NewsCategory {
  return value === "industry" ? "industry" : "economy";
}

export async function GET(request: NextRequest) {
  const category = normalizeCategory(request.nextUrl.searchParams.get("category"));
  try {
    const data = await fetchHankyungNews(category);
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch news.";
    return NextResponse.json({ data: [], error: message }, { status: 502 });
  }
}
