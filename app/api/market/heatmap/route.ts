import { NextResponse } from "next/server";
import { fetchMarketHeatmap } from "@/lib/marketHeatmapData";

export async function GET() {
  try {
    const data = await fetchMarketHeatmap();
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch market heatmap.";
    return NextResponse.json({ data: [], error: message }, { status: 502 });
  }
}
