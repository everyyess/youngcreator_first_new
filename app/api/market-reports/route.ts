import { NextRequest, NextResponse } from "next/server";
import { generateMarketReport, listMarketReports, saveMarketReportPbComment, type MarketReportMarket } from "@/services/marketReportService";

function parseMarkets(value: string | null): MarketReportMarket[] {
  const selected = (value || "us,kr").split(",").map((item) => item.trim()).filter(Boolean);
  return selected.filter((item): item is MarketReportMarket => item === "us" || item === "kr");
}

export async function GET(request: NextRequest) {
  const markets = parseMarkets(request.nextUrl.searchParams.get("markets"));
  const result = await listMarketReports(markets.length ? markets : ["us", "kr"]);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const market = body.market === "us" || body.market === "kr" ? body.market as MarketReportMarket : null;

  if (!market) {
    return NextResponse.json({ error: "market must be us or kr." }, { status: 400 });
  }

  const result = await generateMarketReport(market, "manual");
  return NextResponse.json(result, { status: result.report.generationStatus === "failed" ? 502 : 200 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const pbComment = typeof body.pbComment === "string" ? body.pbComment.slice(0, 100) : "";
  const result = await saveMarketReportPbComment(pbComment);

  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result);
}
