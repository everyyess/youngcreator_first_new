import { NextResponse } from "next/server";
import { fetchMarketIndices } from "@/lib/marketData";

export async function GET() {
  try {
    const data = await fetchMarketIndices();
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch market indices.";
    return NextResponse.json({ data: [], error: message }, { status: 502 });
  }
}
