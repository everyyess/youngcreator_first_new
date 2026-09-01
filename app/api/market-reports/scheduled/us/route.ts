import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { runScheduledMarketReport } from "@/services/marketReportService";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.MARKET_REPORT_CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === "Bearer " + secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runScheduledMarketReport("us");
  return NextResponse.json(result, { status: result.report.generationStatus === "failed" ? 502 : 200 });
}

