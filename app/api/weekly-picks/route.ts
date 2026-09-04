import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { WeeklyPick } from "@/app/api/weekly-picks-ocr/route";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function admin() {
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type Row = {
  name: string;
  recommended_date: string | null;
  return_pct: number | null;
  thesis: string | null;
  is_new: boolean;
  is_non_coverage: boolean;
  sort_order: number;
};

export async function GET() {
  const client = admin();
  if (!client) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY 서버 환경변수가 필요합니다." }, { status: 501 });
  }

  // uploaded_at이 가장 최신인 배치(=마지막 업로드) 하나만 반환
  const { data: latest, error: latestErr } = await client
    .from("weekly_top_picks")
    .select("uploaded_at")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) return NextResponse.json({ error: latestErr.message }, { status: 500 });
  if (!latest) return NextResponse.json({ picks: [] });

  const { data, error } = await client
    .from("weekly_top_picks")
    .select("name, recommended_date, return_pct, thesis, is_new, is_non_coverage, sort_order")
    .eq("uploaded_at", latest.uploaded_at)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const picks: WeeklyPick[] = (data ?? []).map((row: Row) => ({
    name: row.name,
    recommendedDate: row.recommended_date,
    returnPct: row.return_pct,
    thesis: row.thesis,
    isNew: row.is_new,
    isNonCoverage: row.is_non_coverage,
  }));

  return NextResponse.json({ picks });
}

export async function POST(request: Request) {
  const client = admin();
  if (!client) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY 서버 환경변수가 필요합니다." }, { status: 501 });
  }

  const payload = await request.json().catch(() => null) as { picks?: WeeklyPick[] } | null;
  const picks = payload?.picks;
  if (!Array.isArray(picks) || picks.length === 0) {
    return NextResponse.json({ error: "저장할 종목 리스트가 없습니다." }, { status: 400 });
  }

  const uploadedAt = new Date().toISOString();
  const rows: Row[] = picks.map((p, i) => ({
    name: p.name,
    recommended_date: p.recommendedDate,
    return_pct: p.returnPct,
    thesis: p.thesis,
    is_new: p.isNew,
    is_non_coverage: p.isNonCoverage,
    sort_order: i,
  }));

  const { error } = await client
    .from("weekly_top_picks")
    .insert(rows.map((r) => ({ ...r, uploaded_at: uploadedAt })));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, uploadedAt });
}
