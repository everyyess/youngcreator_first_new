import { NextRequest, NextResponse } from "next/server";
import { getJob, listJobs } from "@/Engine/Research-Engine/jobStore";
import {
  approveHumanResearch, serializeResearchJob, startHumanResearch,
} from "@/Engine/Research-Engine/humanApprovalPipeline";
import { getInsightSupabase, insightDbUnavailable } from "@/lib/supabaseInsightDb";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!getInsightSupabase(req)) return NextResponse.json(insightDbUnavailable(), { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const job = getJob(id);
    return job ? NextResponse.json({ job: serializeResearchJob(job) })
      : NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ jobs: listJobs(20).map(serializeResearchJob) });
}

export async function POST(req: NextRequest) {
  const db = getInsightSupabase(req);
  if (!db) return NextResponse.json(insightDbUnavailable(), { status: 401 });
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "올바른 JSON 요청이 필요합니다." }, { status: 400 }); }
  const input = body && typeof body === "object" && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), baseUrl: req.nextUrl.origin }
    : body;
  const outcome = await startHumanResearch(db, input);
  return NextResponse.json(
    outcome.error ? { error: outcome.error } : { jobId: outcome.job?.id, job: outcome.job },
    { status: outcome.status },
  );
}

export async function PATCH(req: NextRequest) {
  if (!getInsightSupabase(req)) return NextResponse.json(insightDbUnavailable(), { status: 401 });
  let body: { jobId?: string; action?: string; expectedStep?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "올바른 JSON 요청이 필요합니다." }, { status: 400 }); }
  if (body.action !== "approve" || !body.jobId || !Number.isInteger(body.expectedStep)) {
    return NextResponse.json({ error: "승인할 작업과 STEP 정보가 필요합니다." }, { status: 400 });
  }
  const outcome = await approveHumanResearch(body.jobId, Number(body.expectedStep));
  return NextResponse.json(
    outcome.error ? { error: outcome.error } : { job: outcome.job },
    { status: outcome.status },
  );
}
