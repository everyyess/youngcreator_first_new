import { NextRequest, NextResponse } from "next/server";
import { getJob, listJobs } from "@/Engine/Research-Engine/jobStore";
import {
  approveHumanResearch, serializeResearchJob, startHumanResearch,
} from "@/Engine/Research-Engine/humanApprovalPipeline";
import { getInsightSupabase, insightDbUnavailable } from "@/lib/supabaseInsightDb";

export const runtime = "nodejs";
// 이 라우트의 POST는 STEP 단위 작업을 동기로 끝낸다. 한 요청이 Gemini를 여러 번 호출한다.
//   STEP4 토론 = 입론2(병렬) → 반박2(병렬) → 종합판정 = 순차 3파
//   STEP5 보고서 = 생성 1회 + 필요 시 재시도 1회 = 순차 2회
// geminiRunner의 호출당 내부 타임아웃은 120초다. 기존 maxDuration 60초는 이보다도 짧아,
// 느린 호출에서 코드의 타임아웃·키/모델 폴백이 동작하기 전에 플랫폼이 함수를 먼저 끊었다
// (로컬 dev에는 이 상한이 없어 드러나지 않음). 폴백이 실제로 작동할 여유를 준다.
export const maxDuration = 300;

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
