import { NextResponse } from "next/server";
import { fetchMarketCalendarAll } from "@/lib/calendarData";

export async function GET() {
  try {
    const data = await fetchMarketCalendarAll();
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch market calendar.";
    return NextResponse.json({ data: [], error: message }, { status: 502 });
  }
}
